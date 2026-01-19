import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Bundle all @vestlang/* packages into the output
  noExternal: [/@vestlang\/.*/],
  // External runtime dependencies (date-fns is used by evaluator)
  external: ["date-fns"],
});
