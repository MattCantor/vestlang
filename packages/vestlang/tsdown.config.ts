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
// Only the JS pass builds them together — sharing a pass lets rolldown hoist
// what they have in common (the whole parse/normalize/lint stack) into one
// chunk, so the subpath costs a consumer almost nothing on disk.
const entries = ["src/index.ts", "src/authoring.ts"];

export default defineConfig([
  {
    ...shared,
    entry: entries,
    dts: false,
    sourcemap: true,
    clean: true,
  },
  // Declarations are emitted one entry at a time, and every pass after the
  // first must leave `dist` alone. A shared declaration pass splits too, but
  // writes its chunk as `foo.d.ts` while the import that reaches for it still
  // says `foo.js` — TypeScript resolves that fine, the publish guard's
  // file-exists check does not. Self-contained declarations per entry sidestep
  // that, and the price is real: a whole extra type-bundling pass per entry
  // (~3.5s each here) plus ~5 KB of duplicated type text.
  ...entries.map((entry) => ({
    ...shared,
    entry: [entry],
    dts: { emitDtsOnly: true },
    clean: false,
  })),
]);
