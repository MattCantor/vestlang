import { defineConfig, type UserConfig } from "tsdown";

// The published umbrella. The private @vestlang/* packages are inlined into the
// JS and declaration output so the published package is self-contained — bare
// `dts: true` would leave re-exports from packages that never reach npm.
// `@vestlang/core` and `zod` are real runtime dependencies (core ships
// separately, shared with OCF-Tools) and stay external, which is tsdown's
// default for declared deps; the negative lookahead keeps core out of the
// private-package catch-all.
//
// Two passes, mirroring @vestlang/core's config: sourcemaps belong to the JS
// bundle only. A single pass with `sourcemap: true` stamps the declaration file
// with a sourceMappingURL comment pointing at a map that is never emitted.
const shared = {
  entry: ["src/index.ts"],
  format: ["esm"],
  // Keep the tsup-era artifact names (`index.js` / `index.d.ts`) that
  // package.json's exports map points at.
  fixedExtension: false,
  deps: { alwaysBundle: [/@vestlang\/(?!core)/] },
} satisfies UserConfig;

export default defineConfig([
  {
    ...shared,
    dts: false,
    sourcemap: true,
    clean: true,
  },
  {
    ...shared,
    dts: { emitDtsOnly: true },
    clean: false,
  },
]);
