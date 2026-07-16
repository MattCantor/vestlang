import { defineConfig } from "tsdown";

// @vestlang/types is the type-only leaf every other package points at. Bundling
// its declarations into a single self-contained `dist/index.d.ts` (no relative
// re-exports across files) lets dependents — notably @vestlang/core, whose
// published `.d.ts` must stand alone — inline these types cleanly with no
// dangling cross-module imports. The JS output is near-empty (every export is a
// type, erased at build) and unused: consumers resolve only the `types` entry.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  fixedExtension: false,
  clean: true,
});
