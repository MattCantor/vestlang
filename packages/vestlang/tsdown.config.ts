import { defineConfig, type UserConfig } from "tsdown";

// The published umbrella. The private @vestlang/* packages are inlined into the
// JS and declaration output so the published package is self-contained — bare
// `dts: true` would leave re-exports from packages that never reach npm.
// `@vestlang/core` and `zod` are real runtime dependencies (core ships
// separately, shared with OCF-Tools) and stay external, which is tsdown's
// default for declared deps; the negative lookahead keeps core out of the
// private-package catch-all.
//
// Sourcemaps belong to the JS bundle only, so JS and declarations are separate
// passes (mirroring @vestlang/core's config). A single pass with
// `sourcemap: true` stamps the declaration file with a sourceMappingURL comment
// pointing at a map that is never emitted.
const shared = {
  format: ["esm"],
  // Keep the tsup-era artifact names (`index.js` / `index.d.ts`) that
  // package.json's exports map points at.
  fixedExtension: false,
  deps: { alwaysBundle: [/@vestlang\/(?!core)/] },
} satisfies UserConfig;

// The two published entries: the main barrel and the `./authoring` subpath.
// Both passes build them together — sharing a pass lets rolldown hoist what they
// have in common (the whole parse/normalize/lint stack) into one chunk, so the
// subpath costs a consumer almost nothing on disk.
const entries = ["src/index.ts", "src/authoring.ts"];

export default defineConfig([
  {
    ...shared,
    entry: entries,
    dts: false,
    sourcemap: true,
    clean: true,
  },
  // Declarations run in their own pass — separate from the sourcemapped JS pass
  // above (see the file header) — but still over both entries at once, so the
  // shared types the two barrels reach for hoist into a single declaration
  // chunk instead of duplicating. `clean: false` keeps the first pass's JS.
  {
    ...shared,
    entry: entries,
    dts: { emitDtsOnly: true },
    clean: false,
  },
]);
