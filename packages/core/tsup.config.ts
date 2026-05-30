import { defineConfig } from "tsup";

// Core is the standalone, publishable engine (`@vestlang/core`). It ships dual
// CJS/ESM so an external CommonJS consumer (OCF-Tools) can `require()` it while
// this ESM-first repo `import`s it natively. Core is self-contained — no
// runtime dependencies — so nothing is marked external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
});
