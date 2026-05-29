# Core / Extended Split

Split vestlang into a `core` engine (OCF-canonical interface, verbatim) and an `extended` layer (runtime-aware resolver + DSL), so a single vesting engine serves both vestlang and OCF-Tools.

## Status

- **Status**: Staged for Implementation (8 phases; see Implementation Phases)
- **Priority**: High
- **Complexity**: High
- **Spans**: `vestlang` (this repo) + `OCF-Tools` (`~/code/OCF-Tools`, branch `add-canonical-vesting-compiler`)

---

## Overview

vestlang's evaluator and OCF-Tools' `vesting_compiler/` are cousins solving the same problem twice: DATE/EVENT anchoring, periodic installments, cliffs, cumulative-round-down, EOM clamping. This spec consolidates them into **one engine**.

- **`core`** — input is a fully-concrete, combinator-free OCF-canonical template + runtime + total shares; output is exact installments. Independently consumable; **OCF-Tools depends on it directly, with zero translation**.
- **`extended`** — the DSL/parser front-end + a runtime-aware **resolver** that resolves combinators (`LATER_OF`/`EARLIER_OF`, `AND`/`OR`, constraints, event-gated cliffs) into concrete anchors, lowers to core IR, calls core, and assembles the result. Owns the `UNRESOLVED`/`IMPOSSIBLE`/blocker vocabulary; core never sees those.

The split decouples *runtime-aware resolution* (extended) from *exact allocation* (core), eliminating the duplicated engine and giving OCF-Tools a real reference implementation.

---

## Background & key decisions

These were worked through and settled; recorded here as the decision record.

### The engine to keep is vestlang's, not OCF-Tools'

The original framing ("port OCF-Tools' `vesting_compiler` in as core") was backwards. vestlang's evaluator is already a compiler, and the *more capable* one:

| | vestlang evaluator | OCF-Tools `vesting_compiler` |
|---|---|---|
| Allocation modes | **6** | 1 (cumulative-round-down; rest throw) |
| Vesting-day-of-month | **configurable** (28 fixed + `*_OR_LAST_DAY`) | 1 policy only |
| Date stepping | **DST-safe UTC** | basic |
| Numerics | `number` | **exact rational (`Fraction`)** |
| Cliff | temporal fold | **positional `{occurrence, percentage}`** |
| Combinator-free IR shape | no (rich AST) | **yes (canonical template)** |
| Structural validation | no | **yes** |

So core takes **vestlang's implementation** (left column) and **OCF-Tools' four genuine wins** (right-column bolds): the canonical IR shape, exact-rational numerics, the positional cliff, and structural/runtime validation. OCF-Tools' `compile.ts` becomes the **reference spec for the IR**, not shipped code.

### Core's interface is OCF canonical, verbatim — no bridge

Core's *interface* = OCF canonical exactly: hoisted `runtime.startDate`, DATE-cursor chaining, floating EVENT statements, positional `{occurrence, percentage}` cliff. **OCF data flows straight in; OCF-Tools has no adaptation to do.** Any divergence would force an OCF↔core bridge — exactly the duplicated translation layer we're deleting.

vestlang's extra needs (6 allocation modes, configurable vesting-day-of-month) enter as **additive, optional fields that default to OCF's current behavior** (day-of-month → `VESTING_START_DAY_OR_LAST_DAY_OF_MONTH`; allocation → cumulative-round-down). OCF data is therefore a valid **subset** of core's input — never a translation. **All** rich-AST→canonical adaptation lives in extended; that *is* extended's job.

### Core ⊇ DSL on arithmetic; DSL ⊇ core on intent — so the DSL is not extended

They are expressive on different axes:

- **Core is wider on resolved arithmetic**: non-proportional cliffs, arbitrary per-occurrence fractions. These are machine-data artifacts (existing ledgers, rounding, raw tranche arrays) — *humans don't author them*.
- **The DSL is wider on unresolved intent**: `LATER_OF`/`EARLIER_OF`, `AND`/`OR`, `BEFORE`/`AFTER`, event-gated cliffs. **Core is combinator-free and cannot represent any of these.**

One DSL expression maps to *different* core templates depending on runtime (IPO fired → one template; not fired → unresolved-with-blockers). That one-to-many projection is the whole reason extended exists. Mental model: **DSL = source language** (intent, ergonomics, lintable, the inferrer's target); **core = IR/bytecode** (exact, validated, runtime-resolved, shared by multiple producers).

The DSL needs no new syntax for non-proportional cliffs: genuine non-proportional graded vesting is already expressible as **multiple PORTION statements**, which extended lowers to multiple core statements. The proportional DSL cliff is simply core's `percentage = K/N` special case.

### Other reframes

- **"Extended never allocates" is unachievable.** The published surface emits `UnresolvedInstallment`s carrying an allocated **amount with no date** (`packages/types/src/evaluation.ts`). Resolution: **one allocator implementation**, exported from core as a pure primitive, called by *both* core's compiler and extended's residual rendering. One implementation, two call sites — no two allocators that can disagree.
- **The cliff fold and the grant-date fold are the same primitive.** `evaluateCliffGeneric<T>` (`packages/evaluator/src/evaluate/cliff.ts`) is parameterized; its three thin callers (`evaluateGrantDate`, `evaluateResolvedCliff`, `evaluateUnresolvedCliff`) all route through it. Off-grid cliffs reuse this fold / core's EVENT-anchor — **no separate cliff concept**.
- **Clean break / new major** of `@nathamcrewott/vestlang`. The resolver/assembler keeps the `@vestlang/evaluator` name (its API stays `evaluate*`); "core"/"extended" are layer terms.
- **`@vestlang/core` is published standalone**, so OCF-Tools can depend on it directly. Today every `@vestlang/*` package is private and inlined into `@nathamcrewott/vestlang` via tsup `noExternal`; core is the exception. It ships under a newly-owned **`@vestlang` npm org** (package name `@vestlang/core`, `private` dropped, `publishConfig.access: public`), dual CJS/ESM. All other `@vestlang/*` packages stay private/inlined — unchanged. OCF-Tools depends on the published `@vestlang/core` (CJS entry); release rides the existing changesets pipeline. Registering the `@vestlang` org is a one-time prerequisite (see Phase 0).

---

## Architecture

```
DSL string ──parse──► RawProgram ──normalizeProgram──► Program (rich AST)
                                                          │
                                       extended: resolve + lower (runtime-aware)
                                                          │
                                   ┌──────────────────────┴───────────────────────┐
                                   ▼                                               ▼
                   jobs[]: { template, runtime, totalShares }            residual { blockers, symbolic }
                       (one per independent anchor-group)                          │
                                   │                                               │
                          core: compile (exact rational)                          │
                                   ▼                                               │
                          ResolvedInstallment[] ───────────► assemble ◄───────────┘
                                                                  │
                                                          EvaluatedSchedule

        OCF data ─────────────────► core (same engine; positional cliffs incl. non-proportional)
```

Core never sees a blocker, combinator, or symbolic date. Extended owns the entire `UNRESOLVED`/`IMPOSSIBLE`/blocker vocabulary.

### How core interprets a template (OCF semantics, verbatim)

Statements run in `order` against a `dateCursor = runtime.startDate`:

- **DATE** statement → expand `occurrences` events from the cursor, then advance the cursor by the full duration. This chaining is what makes graded (e.g. 5/15/40/40) schedules work **in an OCF-canonical template that relies on it**. (DSL-origin graded schedules don't take this path — they arrive as independent per-statement jobs; see "Resolver output contract" below.)
- **EVENT** statement → expand at the matching firing's date from `runtime.eventFirings`; **does not touch the cursor** (floats — correct for acceleration events, and principled, since an event date is a runtime value you cannot statically chain through).

Consequence: `order` is a temporal chain for DATE statements but only identity/tie-break for EVENT statements. Unfired EVENT → statement skipped (extended renders that portion as residual/blockers instead).

### Resolver output contract

```ts
extended.resolve(program, runtime) → ResolveResult

ResolveResult = {
  // One canonical compile job per independently-anchored statement. The DSL has
  // no relative-to-prior anchoring — every statement resolves against its own
  // DATE/EVENT/grant-date+offset base — so the resolver never collapses statements
  // into a cursor-chained multi-statement group. Each job is a verbatim OCF template.
  jobs: Array<{ template: VestingScheduleTemplate, runtime: VestingRuntime, totalShares: number }>,
  residual: { blockers: Blocker[], symbolic: SymbolicInstallment[] }   // what core can't represent
}
```

Cursor chaining (DATE advances the cursor, EVENT floats) is **exclusively core's OCF-canonical interface**, preserved verbatim for OCF data fed straight into core. It is never produced by the resolver: `evaluateProgram` already maps statements with no cursor carried between them, and a graded 5/15/40/40 is four independent PORTION statements — so DSL input always fans out to per-statement jobs.

The published `EvaluatedSchedule` is **assembled** = (core compile across all `jobs`, RESOLVED) ∪ `residual.symbolic` (UNRESOLVED/IMPOSSIBLE) ∪ `residual.blockers`. The per-anchor-group fan-out represents vestlang's independently-anchored statements **without changing the IR**. `normalizeProgram` stays a pre-resolution pass; the resolver is a second pass after it.

### Cliff lowering (extended → core)

Extended resolves the cliff `VestingNodeExpr` (reusing `evaluateVestingNodeExpr`), then lowers:

- **Case A — cliff lands ON a grid boundary** (`d_K == cliffDate`): one core statement, `cliff: {occurrence: K, percentage: K/N}` (GCD-reduced `Fraction`). The only case the DSL produces.
- **Case B — cliff OFF-grid** (event-gated, or a date between boundaries): **split into two core statements**, reusing core's off-grid primitives — pre-cliff aggregate as a one-occurrence EVENT-anchored statement (`occurrences:1, period:0`; core's "unfired → skip" handles the unresolved case) or a DATE statement at `cliffDate`; post-cliff remainder as the residual grid (`occurrences = N − m`).
- **Edge cases**: cliff after all occurrences → single `occurrences:1, period:0` statement at the cliff anchor (core's `Cliff.occurrence` can't exceed `occurrences`). Cliff before/at start → plain grid, no cliff. Unresolved cliff → extended emits `UNRESOLVED_CLIFF` installments via the standalone allocator; a probed `LATER_OF` resolved tail lowers normally.
- **Non-proportional cliffs** are never produced by the DSL path; they enter core only via OCF data, carried as an exact `Fraction` (never re-derived as `K/N`).

### Numerics

Core computes in exact `Fraction` and emits integer shares (`floorSharesAt` uses BigInt to avoid overflow). Two emit shapes off one engine: `compile(...) → {date, amount: string}[]` (OCF-native, for OCF-Tools) and `compileToInstallments(...) → {date, amount: number}[]` (for extended). The clean break lets us fix the latent PORTION rounding (`grantQuantity·(num/den)` in float → exact-rational-then-floor); document the resulting numeric diffs in the changeset.

---

## Scope

### Included

- New `packages/core` (dual CJS/ESM) = vestlang's engine over the OCF-canonical IR.
- Rationalized single allocator (all 6 modes), policy-aware date math (day-of-month, DST), positional cliff, structural/runtime validation.
- Extended resolver + lowering + assembler; `@vestlang/evaluator` retains its `evaluate*` API.
- OCF-Tools repointed at `@vestlang/core` (its own commit/PR).
- Clean-break major version of `@nathamcrewott/vestlang`.

### Explicitly deferred

| Item | Why |
|---|---|
| `FRACTIONAL` allocation mode | Not in vestlang's `allocation_type` union; out of scope until the spec carries it. |
| Renaming `evaluator` → `extended` | "core"/"extended" stay as layer terms; renaming would desync from the `evaluate*` API. |
| Day-of-month / allocation fields in the *template* | They ride on `runtime` (additive-optional), so OCF canonical templates stay verbatim. |
| Independent absolute starts as a single core call | Handled by extended's per-anchor-group fan-out, not by enriching the IR. |

---

## Implementation Phases

Each phase keeps `pnpm build` + `turbo test` green and is a self-contained commit. Phase 6 is a separate repo and PR. The published `@nathamcrewott/vestlang` surface is only intentionally reshaped at Phase 5b/7.

### Phase Dependencies

```
Phase 0  ──►  Phase 1  ──►  Phase 2  ──►  Phase 3  ──►  Phase 4  ──►  Phase 5a  ──►  Phase 5b  ──►  Phase 7  ──►  Phase 6
hygiene       core IR       core         core            resolver      assembler      retire        release       OCF-Tools
+ org reg     + validate    engine       compile         + lowering    + diff gate    legacy        + publish     (separate repo)

Notes:
  • Phase 0's org registration is an external lead-time prerequisite consumed only at Phase 7.
  • Phase 4 depends on Phase 3 (the core compile API it lowers to), not just Phase 1.
  • Phase 5a needs BOTH the resolver (4) and a working old engine; 5b deletes the old engine only after 5a's differential gate is green.
  • Phase 6 lives in OCF-Tools and depends on the published @vestlang/core from Phase 7.
```

---

### Phase 0 — Hygiene + publishing prerequisite

**Goal:** Remove cruft that would otherwise mask later moves; secure the publish target.

**Why First:** The deep cross-package imports and dead `packages/ast` would obscure the engine relocation in Phases 2–3; cleaning them now keeps later diffs legible. Registering the npm org is an external lead-time action that Phase 7 depends on — start it early.

**Outputs:**
- `@vestlang/types` imports fixed in `cliff.ts`, `build.ts`, and `makeTranches.ts` (all three carry the deep `../../../types/dist/...` path).
- `apps/cli/package.json` `"workspace: *"` typo fixed.
- Dead `packages/ast` deleted, canonical JSON schemas first salvaged into core/docs.
- `@vestlang` npm org registered (free, public) — no code depends on it yet.

**Definition of Done:**
- [ ] `pnpm build` + `turbo test` green, no behavior change.
- [ ] No deep `../../../types/dist/...` imports remain.
- [ ] `@vestlang` npm org registered and owned.
- [ ] Commit: `chore: fix cross-package imports and remove dead ast package`.

---

### Phase 1 — core foundation

**Goal:** `packages/core` skeleton with the IR and validation, no consumers yet.

**Inputs:**
- Clean cross-package imports from Phase 0.
- Reference shapes: `~/code/OCF-Tools/types/canonical/vesting/types.ts`, `vesting_compiler/validate.ts`.

**Outputs:**
- New `packages/core/**` with dual CJS/ESM tsup, packaged to publish standalone as `@vestlang/core` (no `private`, `publishConfig.access: public`).
- Canonical IR types: `VestingScheduleTemplate`, `VestingStatement`, positional `Cliff`, `Fraction`, `PeriodType`, `VestingRuntime` (incl. additive-optional `vestingDayOfMonth`/allocation).
- Ported `validate.ts` (template + runtime halves).

**Definition of Done:**
- [ ] core builds + tests pass in isolation; nothing else imports it.
- [ ] Package is configured to publish standalone (private dropped, public access).
- [ ] Commit: `feat(core): canonical IR types + structural/runtime validation`.

---

### Phase 2 — core engine

**Goal:** Move vestlang's engine into core over the IR; **convert the allocator to exact rational**.

**Inputs:**
- Phase 1 IR types and package skeleton.
- Sources: `packages/evaluator/src/evaluate/{allocation,time,cliff}.ts`.

**Outputs:**
- Relocated `allocation.ts`, `time.ts`, and the cliff/grant-date fold mechanics.
- All 6 allocation modes restated on `Fraction` (`floor((i+1)/n·q)` → `floorSharesAt(q,{numerator:i+1,denominator:n})`; `CUMULATIVE_ROUNDING` → rational round-half; `FRONT/BACK_LOADED` already integer-exact).
- `allocateExact` + `allocateVector` exported as the single allocator primitive.
- `vestingDayOfMonth` threaded from runtime into date steppers (`addMonthsRule` / `addDays`).
- New `packages/core/src/{allocate,dates,fractions,fold}.ts`.

**Definition of Done:**
- [ ] Parity tests: rationalized output equals old `allocateQuantity` across all 6 modes.
- [ ] Date math (day-of-month, DST) unchanged vs. legacy.
- [ ] Commit: `feat(core): port vestlang allocator + date math (exact rational)`.

---

### Phase 3 — core compile

**Goal:** The `compile` / `compileToInstallments` entry points over the IR.

**Inputs:**
- Phase 2 allocator primitive + date math + fold.

**Outputs:**
- `packages/core/src/compile.ts`: statement expansion (DATE cursor + EVENT firings), chronological sort, rational cumulative allocation, positional cliff expansion (`perEventGrantFractions`-style), grant-date fold, EVENT-unfired skip.
- Dual emit: `compile(...) → {date, amount: string}[]` (OCF-native) and `compileToInstallments(...) → {date, amount: number}[]` (extended).
- OCF-Tools' `vesting_compiler/__tests__` ported as core conformance tests.

**Definition of Done:**
- [ ] core compiles representative DATE/EVENT/cliff templates.
- [ ] Totals telescope exactly to total shares.
- [ ] Conformance tests (ported from OCF-Tools) pass.
- [ ] Commit: `feat(core): canonical compile (dual numeric/OCF emit)`.

---

### Phase 4 — resolver + lowering

**Goal:** Extended's `resolveToCore` producing the `ResolveResult` contract, landed behind a new entry (not wired live).

**Inputs:**
- Phase 3 `compile` API (the lowering target).
- Existing selector layer: `selectors.ts`, `vestingNode/*`, `constraint.ts`.

**Outputs:**
- New `packages/evaluator/src/resolve/**` (depends on `@vestlang/core`).
- Combinator/constraint/event resolution reusing the selector layer.
- Cliff lowering: Case A (on-grid, single statement `{occurrence: K, percentage: K/N}`), Case B (off-grid split into two statements), and edge cases.
- Per-anchor-group job fan-out (one canonical job per independently-anchored statement).
- `residual` blockers + symbolic installments emission.

**Definition of Done:**
- [ ] Unit tests for cliff lowering (Cases A/B + edges) pass.
- [ ] Unit tests for partial-resolution (unfired-event, unresolved-cliff) cases pass.
- [ ] Per-anchor-group fan-out verified against a graded multi-statement program.
- [ ] Not wired into the live public path yet.
- [ ] Commit: `feat(evaluator): runtime-aware resolver + lowering to core IR`.

> **Note:** This is the heaviest phase. If it runs long, pause at a green sub-checklist boundary (resolution → Case A → Case B+edges → fan-out → residual) rather than splitting the commit.

---

### Phase 5a — assembler + cutover (behind a flag)

**Goal:** Route the public API through resolve + core + assemble, with the old in-evaluator engine still reachable so the gate can compare both.

**Inputs:**
- Phase 4 resolver (`ResolveResult`).
- The still-present legacy engine (required for the differential comparison).

**Outputs:**
- Assembler (core results ∪ residual) producing `EvaluatedSchedule`.
- `evaluateStatement` / `evaluateProgram` / `evaluateStatementAsOf` flipped to call the new path.
- Old engine kept reachable behind an internal flag (no public-surface change yet).

**Definition of Done (the gate):**
- [ ] Existing evaluator suite runs through **both** old and new paths.
- [ ] `EvaluatedSchedule` identical except the documented PORTION exact-rational diffs (deliberate golden-file updates).
- [ ] Old path still exists and is reachable for comparison.
- [ ] Commit: `feat: route evaluation through core engine (behind flag)`.

---

### Phase 5b — retire the legacy engine (clean break)

**Goal:** Delete the old in-evaluator engine and the flag once the gate is green; reshape the public surface.

**Inputs:**
- Green differential gate from Phase 5a.

**Outputs:**
- Old `evaluateSchedule` / `allocateQuantity` / `evaluateCliff` allocation code and the internal flag deleted.
- Umbrella exports reshaped to expose `core`.

**Definition of Done:**
- [ ] build + tests green on the new path only.
- [ ] No references to the removed engine remain.
- [ ] Commit: `feat!: remove legacy evaluator engine (clean break)`.

---

### Phase 7 — release

**Goal:** Ship the major and publish `@vestlang/core` standalone.

**Inputs:**
- Phase 5b clean-break surface.
- `@vestlang` org from Phase 0.

**Outputs:**
- Changeset documenting the new standalone `@vestlang/core` package, the PORTION numeric change, and the reshaped `@nathamcrewott/vestlang` surface.
- `@vestlang/core` and `@nathamcrewott/vestlang` published via changesets.

**Definition of Done:**
- [ ] `@vestlang/core` published under the `@vestlang` org (CJS entry available for OCF-Tools).
- [ ] `@nathamcrewott/vestlang` major published.
- [ ] Commit: `chore: release @nathamcrewott/vestlang vX + @vestlang/core (core/extended)`.

---

### Phase 6 — OCF-Tools migration *(separate repo + PR)*

**Goal:** OCF-Tools consumes `@vestlang/core`; its duplicate engine is deleted.

**Inputs:**
- Published `@vestlang/core` (CJS entry) from Phase 7.

**Outputs:**
- In `~/code/OCF-Tools`: `vesting_compiler/` + `types/canonical/vesting/` deleted.
- Dependency on the published `@vestlang/core`; transaction cross-referencing kept.
- Exact compiled-vs-recorded comparison re-run.

**Definition of Done:**
- [ ] OCF-Tools suite green against `@vestlang/core`.
- [ ] Includes a non-proportional-positional-cliff fixture (proves core carries fidelity the DSL doesn't express).
- [ ] PR opened in OCF-Tools, dependent on `@vestlang/core` being published (Phase 7).

---

## Phase Checklist

### Phase 0: Hygiene + publishing prerequisite
- [ ] `packages/evaluator/src/evaluate/cliff.ts` — `@vestlang/types` import
- [ ] `packages/evaluator/src/evaluate/build.ts` — `@vestlang/types` import
- [ ] `packages/evaluator/src/evaluate/makeTranches.ts` — `@vestlang/types` import
- [ ] `apps/cli/package.json` — `"workspace: *"` typo
- [ ] `packages/ast` — salvage schemas, then delete
- [ ] External: register `@vestlang` npm org

### Phase 1: core foundation
- [ ] `packages/core/package.json` — dual CJS/ESM tsup, public publishConfig
- [ ] `packages/core/src/types.ts` — canonical IR types
- [ ] `packages/core/src/validate.ts` — template + runtime validation

### Phase 2: core engine
- [ ] `packages/core/src/allocate.ts` — 6 modes on `Fraction`; `allocateExact` + `allocateVector`
- [ ] `packages/core/src/dates.ts` — `addMonthsRule` / `addDays` + `vestingDayOfMonth`
- [ ] `packages/core/src/fractions.ts`
- [ ] `packages/core/src/fold.ts` — cliff/grant-date fold mechanics

### Phase 3: core compile
- [ ] `packages/core/src/compile.ts` — `compile` + `compileToInstallments`
- [ ] `packages/core/__tests__/**` — ported OCF-Tools conformance tests

### Phase 4: resolver + lowering
- [ ] `packages/evaluator/src/resolve/index.ts` — `resolveToCore` → `ResolveResult`
- [ ] `packages/evaluator/src/resolve/cliff.ts` — Cases A/B + edges
- [ ] `packages/evaluator/src/resolve/fanout.ts` — per-anchor-group jobs
- [ ] `packages/evaluator/src/resolve/residual.ts` — blockers + symbolic installments

### Phase 5a: assembler + cutover (behind a flag)
- [ ] `packages/evaluator/src/evaluate/*` — assembler + new-path wiring + internal flag
- [ ] `packages/vestlang/src/index.ts`
- [ ] `apps/mcp-server/src/server.ts` — imports
- [ ] Differential gate harness (old vs. new path)

### Phase 5b: retire the legacy engine (clean break)
- [ ] `packages/evaluator/src/evaluate/*` — delete legacy engine + flag
- [ ] `packages/vestlang/src/index.ts` — reshape umbrella exports

### Phase 7: release
- [ ] `.changeset/*` — standalone `@vestlang/core`, PORTION numeric change, reshaped surface
- [ ] Publish `@vestlang/core` + `@nathamcrewott/vestlang`

### Phase 6: OCF-Tools migration *(separate repo)*
- [ ] `~/code/OCF-Tools` — delete `vesting_compiler/` + `types/canonical/vesting/`
- [ ] `~/code/OCF-Tools/package.json` — depend on published `@vestlang/core`
- [ ] OCF-Tools fixtures — add non-proportional-positional-cliff fixture

---

## Verification

- **Per phase**: `pnpm build && pnpm test` green; Phase 2 allocation-parity, Phase 3 conformance, Phase 4 lowering, Phase 5a differential gate.
- **MCP smoke test** (post Phase 5b): `vestlang_compile` → `vestlang_evaluate` on (a) monthly-over-48 with `CLIFF +12 months`; (b) event-gated `CLIFF LATER OF(+12mo, EVENT "ipo")` with and without the firing; (c) a multi-statement graded schedule. Totals telescope exactly to grant quantity; UNRESOLVED/blocker output matches pre-refactor.
- **Inferrer round-trip**: `vestlang_infer_schedule` → feed `dsl` + `diagnostics.{vestingDayOfMonth,allocationType}` back through `vestlang_evaluate`; residual error stays 0.
- **Cross-repo** (Phase 6): OCF-Tools' exact compiled-vs-recorded validator passes on existing fixtures + the non-proportional-cliff fixture.
