# @vestlang/core

## 0.1.2

### Patch Changes

- 26b8dd2: `vestlang_evaluate` now reports an over-allocating schedule as `valid: false` even
  when `grant_quantity` is 0, matching `vestlang_persist`, `vestlang_lint`, and
  rehydrate. A zero-share grant previously suppressed the over-allocation finding, so
  these tools disagreed on the same program. Under-allocation stays silent at a
  zero-share grant (there is nothing left to leave unvested). The `@vestlang/core`
  template checkers `validateTemplateAllocatable` / `templateAllocationFindings` inherit
  the fix and now flag an over-allocating template at grant 0.

## 0.1.1

### Patch Changes

- 9550f7b: Repair the published declaration bundle. tsup's declaration bundler
  (rollup-plugin-dts) mis-resolved zod v4's `.d.cts` re-export specifiers and
  spliced ~30 lines of zod's compiled CommonJS runtime into `dist/index.d.ts` and
  `dist/index.d.cts`, so any consumer compiling with `skipLibCheck: false` failed
  with TS1046/TS1039 inside the package. Core now builds with tsdown; the
  declaration bundle is fully self-contained (no imports, no runtime code) and
  compiles clean under `skipLibCheck: false` on both the ESM and CJS sides.
