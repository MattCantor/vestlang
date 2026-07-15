import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // Fold every resolvable type dependency — the private @vestlang/* packages and
  // the vendored @opencaptablecoalition/ocf-types — into dist/index.d.ts so the
  // published package is self-contained; bare `dts: true` would leave re-exports
  // from packages that never reach npm. `@vestlang/core` is the one type dep left
  // external (it ships separately, shared with OCF-Tools): the `external` list
  // below holds it out of the JS bundle *and* the declaration inlining. `resolve`
  // is `true` rather than a pattern list — the pattern-list form makes
  // rollup-plugin-dts code-split the resolved multi-file packages into chunks
  // tsup never emits, leaving dangling `./chunk.js` re-exports.
  dts: { resolve: true },
  clean: true,
  sourcemap: true,
  // Inline the internal @vestlang/* packages into the JS output, EXCEPT
  // @vestlang/core (negative lookahead) — the engine ships once as a real
  // external dependency.
  noExternal: [/@vestlang\/(?!core)/],
  // External runtime dep: the engine, shipped separately.
  external: ["@vestlang/core"],
});
