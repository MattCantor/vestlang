import { defineConfig } from "tsdown";

// Core is the standalone, publishable reference compiler (`@vestlang/core`). It
// ships dual CJS/ESM so an external CommonJS consumer (OCF-Tools) can `require()`
// it while this ESM-first repo `import`s it natively. Core ships no runtime
// dependencies: its internal runtime deps — `@vestlang/primitives` (the engine
// substrate) and `@vestlang/utils` (fraction math, reached transitively) — are
// *bundled in* rather than shipped, along with `zod`, which rides in
// transitively through the shared canonical schema.
//
// tsdown, not tsup (#542): tsup's declaration bundler (rollup-plugin-dts)
// mis-resolved zod v4's declaration layout — zod's `.d.cts` files re-export via
// explicit `.cjs` specifiers, and the resolver took the literal runtime file
// instead of the sibling `.d.cts`, splicing ~30 lines of live CommonJS into the
// published declarations.
//
// The build is split in two because the JS bundles and the declarations want
// opposite treatments of zod. The JS bundles must inline it (a published CJS
// emitting a bare `require("zod")` would throw for OCF-Tools, which doesn't
// depend on zod). The declaration pass must NOT touch it: rolldown-plugin-dts
// can't bundle zod's CommonJS-syntax `.d.cts` files (it warns, per-file, for all
// ~100 of them) — and it never needs to, since nothing zod-typed survives in
// core's public surface; the schema consts are used as values, so zod's types
// tree-shake out of the bundle entirely.
const entry = ["src/index.ts"];
const formats = ["cjs", "esm"] as const;

export default defineConfig([
  // JS bundles. Every `@vestlang/*` dependency is a private, ESM-only workspace
  // package; bundle them all (plus zod) into both formats so the published
  // output never reaches for a package a consumer's install can't resolve. A
  // catch-all regex — rather than a hand-maintained allowlist — means a future
  // import from any new private package is bundled automatically.
  {
    entry,
    format: [...formats],
    dts: false,
    // Keep the tsup-era artifact names (`index.js` / `index.cjs`) that
    // package.json's exports map points at.
    fixedExtension: false,
    sourcemap: true,
    clean: true,
    deps: { alwaysBundle: [/@vestlang\//, "zod"] },
  },
  // Declarations only. The d.ts closure reaches three off-npm sources — the
  // canonical IR types (`@vestlang/types`), the primitives surface (and
  // `@vestlang/utils` transitively), and the vendored
  // `@opencaptablecoalition/ocf-types` (a `file:` dep) — all folded into the
  // bundle by the same deps decisions that govern the JS pass.
  {
    entry,
    format: [...formats],
    dts: { emitDtsOnly: true },
    fixedExtension: false,
    clean: false,
    deps: {
      alwaysBundle: [/@vestlang\//, "@opencaptablecoalition/ocf-types"],
      // zod would be auto-bundled here too (it's undeclared in core's manifest,
      // and phantom deps bundle when used) — force it external instead.
      neverBundle: [/^zod(\/|$)/],
    },
    // Without this, the externalized zod survives as a bare `import "zod/mini"`
    // in the emitted d.ts — a module a consumer's install can't resolve.
    // Declarations carry no runtime side effects, so dropping unreferenced
    // imports is safe in this pass.
    treeshake: { moduleSideEffects: false },
  },
]);
