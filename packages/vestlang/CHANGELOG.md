# @vestlang/vestlang

## 0.7.0

### Minor Changes

- 13d033a: `vestlang_persist` now stores a cliff `EARLIER OF` whose arms all reference an event
  (for example `CLIFF EARLIER OF (event IPO before …, event CIC before …)`) instead of
  refusing it as unrepresentable. The persisted artifact carries one `event_condition`
  plus the `EARLIER OF` recipe in the sidecar — the same shape the construct already got
  when nested under a `LATER OF` — and `vestlang_evaluate` reports it as a storable
  template. An `EARLIER OF` with any plain time/date arm is unchanged.
- d6c2057: New `@vestlang/vestlang/authoring` subpath for turning prose into vestlang when you
  call an LLM yourself. It ships the authoring prompt, a `validateVestlang` parse-and-lint
  check, the corrective re-prompt, and `authorVestlang` — a propose → verify → refine loop
  that grows one conversation across attempts. There is no model SDK and no transport: you
  supply a `complete` function that runs a single turn against whatever client you already
  use, and the loop calls it up to `maxAttempts` times.

  A reply of exactly `INDETERMINATE` comes back as its own outcome rather than a failure, so
  prose that pins down no schedule is distinguishable from prose the model got wrong. Note
  that a successful result attests the statement parses and lints — not that it means what
  the prose meant; pair it with `verifyObservations` when you have figures to check against.

  The main `@vestlang/vestlang` entry is unchanged, and the prompt does not load unless you
  import the subpath.

- 6c3a557: Add `VESTLANG_GRAMMAR_GUIDE` to `@vestlang/vestlang/authoring`: the same grammar
  material as `VESTLANG_AUTHORING_PROMPT` — the statement form, anchors, selectors,
  conditions, worked translations, and the mistakes that fail validation — with the
  reply-format rules left out, so you can hand it to a chat agent or drop it into
  your own docs without telling the reader to answer with a bare DSL string.

  `VESTLANG_AUTHORING_PROMPT` changes by one sentence in the process: the bullet
  that read "One reply may hold more than one statement" now reads "One program may
  hold more than one statement", since both texts are built from one template. What
  it teaches is unchanged, but the string is no longer byte-identical to the last
  release — worth a look if you snapshot it or diff it in your own tests.

- 2260731: `vestlang_infer_schedule` (and the `inferSchedule` library) now accept an optional
  `grant_quantity` — the stated grant total to check the reconstructed stream
  against. It is diagnostic only: the inferred schedule, the emitted DSL, and the
  returned context are unchanged, and a mismatch is never refused. When supplied,
  the result carries `diagnostics.coverage` (`{ grantQuantity, trancheSum, delta,
status }`, where `status` is `complete` / `partial` / `over`) plus a human note
  when the tranche sum disagrees with the stated grant — the deterministic tell that
  a sparse slice was read as a whole grant. Omit it and the output is unchanged.

### Patch Changes

- 26b8dd2: `vestlang_evaluate` now reports an over-allocating schedule as `valid: false` even
  when `grant_quantity` is 0, matching `vestlang_persist`, `vestlang_lint`, and
  rehydrate. A zero-share grant previously suppressed the over-allocation finding, so
  these tools disagreed on the same program. Under-allocation stays silent at a
  zero-share grant (there is nothing left to leave unvested). The `@vestlang/core`
  template checkers `validateTemplateAllocatable` / `templateAllocationFindings` inherit
  the fix and now flag an over-allocating template at grant 0.
- 056449b: The projection now presents one vested tranche per date. When a schedule lands
  multiple installments on the same day — overlapping `PLUS` arms, or an events-only
  grid the engine can't fold into a single template — the same-date amounts are
  summed into one tranche with strictly increasing dates, instead of surfacing as
  duplicate-date rows. `verifyObservations` grades against this folded projection, so
  its nearest-tranche pointer reports the per-date total rather than one arm's slice.
  Share totals and the over-allocation validity channel are unchanged.
- 503a1a8: Faster cold start for consumers that don't validate a persisted template. The
  `@vestlang/vestlang/authoring` subpath (and any code path that only authors or lints
  vestlang) no longer builds the canonical vesting schema at import time — bundlers now
  tree-shake roughly 20 ms of Zod setup out of it. Paths that do validate are unchanged.
- bee58ec: Schedules whose shares are exact whole numbers of shares now vest those whole numbers.
  A vesting percentage is written to storage as a ten-place decimal, and it used to be
  cut short there — so a third of a 30,000-share grant stored as `0.3333333333` and paid
  9,999 on the cliff, and `19/48 VEST … THEN 29/48 VEST …` of 48,000 paid 18,999 where
  19,000 was exact. Percentages now round up to the ten-place grid instead, which the
  share math's rounding-down absorbs: `VEST OVER 3 years EVERY 1 year CLIFF 1 year` over
  30,000 shares vests 10,000 a year, and the 19/48 split pays its 19,000.

  Multi-statement schedules are written as running totals rounded to the grid, so the
  set still adds up to exactly what was authored — a schedule that leaves shares
  unvested keeps leaving them, and one that over-allocates is still refused rather than
  reshaped. A single tranche can now land one share high (and a later one one share low)
  at grants above roughly a billion shares; the schedule total is unaffected.

  The `precision-insufficient` warning is correspondingly quieter. It no longer fires
  where the stored decimal now lands the right count, and no longer recommends a
  replacement decimal — a value that lands one grant is wrong at the next, and a stored
  template carries no grant. It still fires where ten places genuinely cannot express the
  schedule at the grant size, and still warns conservatively for a cliff lump whose
  realized size depends on what vests before it.

- 5eb9882: `vestlang_lint`, `vestlang_evaluate`, and `vestlang_persist` now reject a gate that
  pins both sides of a BEFORE/AFTER comparison to the same non-date anchor and can never
  be satisfied whenever the event fires — for example `FROM EVENT ipo STRICTLY AFTER
EVENT ipo`, or `FROM EVENT s AFTER EVENT b AND STRICTLY BEFORE EVENT b`. Previously such
  a schedule linted clean and stored as a template even though it resolves to impossible
  the instant the referenced event fires. Lint raises a new `unsatisfiable-event-gate`
  error, evaluate reports the schedule as impossible / not representable, and persist
  refuses it. The check is firing-invariant and deliberately conservative: when an offset
  delta can't be ordered without committing to month lengths (a mixed-sign month+day
  offset), it abstains, so genuinely satisfiable gates are never flagged. Fixed-date gates
  continue to route through the existing `unsatisfiable-date-window` rule, unchanged.
- Updated dependencies [26b8dd2]
  - @vestlang/core@0.1.2

## 0.6.0

### Minor Changes

- dfb6e9e: Export `summarizeVerification`, the one-line human summary composed from a `verifyObservations` result, so consumers can share it instead of hand-copying the composition.

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
