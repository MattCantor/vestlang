import { defineConfig } from "tsup";

// Core is the standalone, publishable reference compiler (`@vestlang/core`). It
// ships dual CJS/ESM so an external CommonJS consumer (OCF-Tools) can `require()`
// it while this ESM-first repo `import`s it natively. Core ships no runtime
// dependencies: its internal runtime deps — `@vestlang/primitives` (the engine
// substrate) and `@vestlang/utils` (fraction math, reached transitively) — are
// *bundled in* rather than shipped, see `noExternal` below.
//
// The declaration closure reaches three off-npm sources: the canonical IR types
// (`@vestlang/types`), the primitives surface (`@vestlang/primitives`, and
// `@vestlang/utils` transitively) that `expandTemplateToRawEvents` returns, and
// the vendored `@opencaptablecoalition/ocf-types` (a `file:` dep). `dts.resolve`
// folds their declarations *into* the bundled `.d.ts` so the published package
// stays self-contained — an external consumer never resolves any of them. It has
// to be `true`, not a pattern list: the private packages are multi-file tsc
// builds, and the pattern-list form leaves rollup-plugin-dts to code-split their
// internal `./x.js` re-exports into chunks tsup never writes, dangling. Full
// resolution inlines the whole graph into one file. (The JS bundle is unaffected:
// these imports are type-only, so esbuild erases them.)
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: { resolve: true },
  sourcemap: true,
  clean: true,
  // Every `@vestlang/*` dependency is a private, ESM-only workspace package; bundle
  // them all into both the CJS and ESM output so the published CJS never emits a
  // bare `require("@vestlang/…")` (which would throw for OCF-Tools). A catch-all
  // regex — rather than a hand-maintained allowlist — means a future import from
  // any new private package is bundled automatically. `zod` rides in transitively
  // through the shared canonical schema; inline it too so core keeps shipping no
  // runtime dependency.
  noExternal: [/@vestlang\//, "zod"],
});
