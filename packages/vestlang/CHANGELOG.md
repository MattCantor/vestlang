# @vestlang/vestlang

## 0.5.1

### Patch Changes

- 9550f7b: Build with tsdown instead of tsup (no longer actively maintained), completing
  the repo-wide migration. The published artifact is unchanged in shape and
  content — same entry points, self-contained declarations, `@vestlang/core` and
  `zod` external as real dependencies.
- Updated dependencies [9550f7b]
  - @vestlang/core@0.1.1

## 0.5.0

### Minor Changes

- 55c0d77: Add `verifyObservations`, a read that grades a proposed vesting schedule against
  dated observations — balance snapshots (vested/unvested share counts) and exact
  tranches — reporting each supplied figure's gap from the schedule's own prediction
  as a percent of the grant. Exposed through the umbrella and as the
  `vestlang_verify_observations` MCP tool.

## 0.4.0

### Minor Changes

- Consolidate the vesting engine into a new standalone `@vestlang/core` package and re-home the umbrella on the `@vestlang` scope.
  - **New `@vestlang/core`** (published separately, dual CJS/ESM): the Carta-aligned canonical interchange engine — exact-rational allocator, time-based cliff, structural + runtime validation. The umbrella now depends on it as a real external dependency (shipped once), while still inlining the other internal packages.
  - **Umbrella renamed** `@nathamcrewott/vestlang` → `@vestlang/vestlang`. The public `evaluate*` / `parse` / `lint` / `stringify` / `inferSchedule` surface is unchanged; `core` is newly re-exported.
  - **PORTION numeric change (intentional):** allocation now uses a single cumulative round-down across the whole ordered template (exact `Fraction`, floored), replacing per-PORTION float rounding. Totals telescope exactly to grant quantity. Output can differ at the share level from prior releases for multi-PORTION schedules; this is a deliberate correctness fix, not a regression.

## 0.3.3

### Patch Changes

- Tidy the README install section — drop the now-irrelevant "no registry configuration needed" note (a leftover from the GitHub Packages era).

## 0.3.2

### Patch Changes

- Sync the README API/Types sections with the 0.3.x exports: document `inferSchedule`, `stringify`/`stringifyProgram`/`stringifyStatement`, and the previously-undocumented types (inferrer types, lint types, installment states, `OCTDate`, `RawProgram`, `VestedResult`).

## 0.3.1

### Patch Changes

- Fix the bundled README: correct the package name and switch the install instructions to public npm (previously referenced the old `@mattcantor` name and GitHub Packages).

## 0.3.0

### Minor Changes

- Bundle the post-0.2.3 fixes and features into the published facade: evaluator seed-day drift fix (correct tranche dates for day-29/30/31-seeded monthly schedules), CLIFF grantDate guard repair, bareword system-event anchors, stringify sugar, and the new schedule inferrer (`inferSchedule`).

## 0.2.2

### Patch Changes

- 8f4f3f9: Prepare packages for publishing to GitHub Package Registry
  - Updated all publishConfig to target GitHub Package Registry consistently
  - Updated exports to put types condition first for proper module resolution
  - Added files fields to ensure only dist is published
  - Updated tsconfig for NodeNext module resolution compatibility
  - Added .js extensions to imports for NodeNext consumers
  - Moved @vestlang/\* from devDependencies to dependencies in facade for type resolution

- Updated dependencies [8f4f3f9]
  - @vestlang/types@0.1.1
  - @vestlang/dsl@0.1.1
  - @vestlang/evaluator@0.1.1
  - @vestlang/stringify@0.1.1
  - @vestlang/normalizer@0.1.1
  - @vestlang/linter@0.1.1
