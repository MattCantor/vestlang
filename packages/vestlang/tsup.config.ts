import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Inline the internal @vestlang/* packages into the output, EXCEPT @vestlang/core
  // (negative lookahead) — the engine ships once as a real external dependency,
  // shared with OCF-Tools.
  noExternal: [/@vestlang\/(?!core)/],
  // External runtime dep: the engine, shipped separately.
  external: ["@vestlang/core"],
});
