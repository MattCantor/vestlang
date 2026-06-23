import { defineConfig } from "tsup";

// Core is the standalone, publishable reference compiler (`@vestlang/core`). It
// ships dual CJS/ESM so an external CommonJS consumer (OCF-Tools) can `require()`
// it while this ESM-first repo `import`s it natively. Core ships no runtime
// dependencies: its internal runtime deps — `@vestlang/primitives` (the engine
// substrate) and `@vestlang/utils` (fraction math, reached transitively) — are
// *bundled in* rather than shipped, see `noExternal` below.
//
// The canonical IR types live in `@vestlang/types` (a private, type-only
// devDependency); core `import type`s them. `dts.resolve` folds those type
// declarations *into* core's bundled `.d.ts` so the published package stays
// self-contained — an external consumer never has to resolve `@vestlang/types`.
// (The JS bundle is unaffected: the imports are type-only, so esbuild erases
// them — `@vestlang/types` ships no JS anyway.)
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: { resolve: true },
  sourcemap: true,
  clean: true,
  // `@vestlang/primitives` and `@vestlang/utils` are ESM-only; inline them into
  // both the CJS and ESM bundles so the published CJS never emits a bare
  // `require("@vestlang/primitives")` / `require("@vestlang/utils")` (which would
  // throw for OCF-Tools). Keeping them devDependencies already makes tsup bundle
  // them; this is explicit so a tsup default change can't externalize them.
  // `zod` rides in transitively through `@vestlang/primitives`' shared canonical
  // schema. Inline it too, so the published CJS never emits a bare
  // `require("zod")` (which would throw for OCF-Tools, which doesn't depend on
  // zod) and core keeps shipping no runtime dependency.
  noExternal: ["@vestlang/primitives", "@vestlang/utils", "zod"],
});
