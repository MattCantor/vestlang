# @nathamcrewott/vestlang

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
