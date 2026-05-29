# Core / Extended Split

Split vestlang into a `core` engine (OCF-canonical interface, verbatim) and an `extended` layer (runtime-aware resolver + DSL), so a single vesting engine serves both vestlang and OCF-Tools.

## Status

- **Status**: Design Specification
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

## Phased roadmap

Each phase keeps `pnpm build` + `turbo test` green and is a self-contained commit. Phase 6 is a separate repo and PR. The published `@nathamcrewott/vestlang` surface is only intentionally reshaped at Phase 5b/7.

### Phase 0 — Hygiene + publishing prerequisite
- **Goal**: remove cruft that would otherwise mask later moves; secure the publish target.
- **Files**: `packages/evaluator/src/evaluate/cliff.ts`, `build.ts`, **and `makeTranches.ts`** (all three carry the deep `../../../types/dist/...` import → `@vestlang/types`); `apps/cli/package.json` (`"workspace: *"` typo); delete dead `packages/ast` (salvage canonical JSON schemas into core/docs first).
- **Prerequisite**: register the `@vestlang` npm org (free, public) so `@vestlang/core` can publish under it at Phase 7; no code depends on this yet.
- **Checkpoint**: build + tests green, no behavior change.
- **Commit**: `chore: fix cross-package imports and remove dead ast package`.

### Phase 1 — core foundation
- **Goal**: `packages/core` skeleton with the IR and validation, no consumers yet.
- **Scope**: dual CJS/ESM tsup, packaged to publish standalone as `@vestlang/core` (no `private`, `publishConfig.access: public`); define canonical IR types (`VestingScheduleTemplate`, `VestingStatement`, positional `Cliff`, `Fraction`, `PeriodType`, `VestingRuntime` incl. additive-optional `vestingDayOfMonth`/allocation) from OCF-Tools' shape as spec; port OCF-Tools `validate.ts` (template + runtime halves).
- **Files**: new `packages/core/**`; reference `~/code/OCF-Tools/types/canonical/vesting/types.ts`, `vesting_compiler/validate.ts`.
- **Checkpoint**: core builds + tests in isolation; nothing else imports it.
- **Commit**: `feat(core): canonical IR types + structural/runtime validation`.

### Phase 2 — core engine
- **Goal**: move vestlang's engine into core over the IR; **convert the allocator to exact rational**.
- **Scope**: relocate `allocation.ts`, `time.ts`, and the cliff/grant-date fold mechanics; restate all 6 allocation modes on `Fraction` (`floor((i+1)/n·q)` → `floorSharesAt(q,{numerator:i+1,denominator:n})`; `CUMULATIVE_ROUNDING` → rational round-half; `FRONT/BACK_LOADED` already integer-exact). Export `allocateExact` + `allocateVector` as the single allocator primitive. Thread `vestingDayOfMonth` from runtime into the date steppers (`addMonthsRule` / `addDays` — `addPeriod` is only the MCP tool surface).
- **Files**: new `packages/core/src/{allocate,dates,fractions,fold}.ts`; sources from `packages/evaluator/src/evaluate/{allocation,time,cliff}.ts`.
- **Checkpoint**: parity tests — rationalized output equals old `allocateQuantity` across all 6 modes; date math (day-of-month, DST) unchanged.
- **Commit**: `feat(core): port vestlang allocator + date math (exact rational)`.

### Phase 3 — core compile
- **Goal**: the `compile` / `compileToInstallments` entry points over the IR.
- **Scope**: statement expansion (DATE cursor + EVENT firings), chronological sort, rational cumulative allocation, positional cliff expansion (`perEventGrantFractions`-style), grant-date fold, EVENT-unfired skip.
- **Files**: new `packages/core/src/compile.ts`; port OCF-Tools' `vesting_compiler/__tests__` as core conformance tests.
- **Checkpoint**: core compiles representative DATE/EVENT/cliff templates; totals telescope exactly to total shares.
- **Commit**: `feat(core): canonical compile (dual numeric/OCF emit)`.

### Phase 4 — resolver + lowering
- **Goal**: extended's `resolveToCore` producing the `ResolveResult` contract, landed behind a new entry (not wired live).
- **Scope**: reuse the existing selector layer (`selectors.ts`, `vestingNode/*`, `constraint.ts`) for combinator/constraint/event resolution; implement cliff lowering (Cases A/B + edges) and per-anchor-group job fan-out; emit `residual` blockers/symbolic installments.
- **Files**: new `packages/evaluator/src/resolve/**`; depends on `@vestlang/core`.
- **Checkpoint**: unit tests for cliff lowering and partial-resolution cases pass.
- **Commit**: `feat(evaluator): runtime-aware resolver + lowering to core IR`.

### Phase 5a — assembler + cutover (behind a flag)
- **Goal**: route the public API through resolve + core + assemble, with the old in-evaluator engine still reachable so the gate can compare both.
- **Scope**: assembler (core results ∪ residual) producing `EvaluatedSchedule`; flip `evaluateStatement`/`evaluateProgram`/`evaluateStatementAsOf` to call the new path; keep the old engine reachable behind an internal flag (no public-surface change yet).
- **Files**: `packages/evaluator/src/evaluate/*`, `packages/vestlang/src/index.ts`, `apps/mcp-server/src/server.ts` imports.
- **Checkpoint** (the gate): run the existing evaluator suite through **both** old and new paths; assert identical `EvaluatedSchedule` except the documented PORTION exact-rational diffs (deliberate golden-file updates). The old path must still exist for this comparison — that's the whole reason 5a precedes 5b.
- **Commit**: `feat: route evaluation through core engine (behind flag)`.

### Phase 5b — retire the legacy engine (clean break)
- **Goal**: delete the old in-evaluator engine and the flag once the gate is green; reshape the public surface.
- **Scope**: delete old `evaluateSchedule`/`allocateQuantity`/`evaluateCliff` allocation code and the internal flag; reshape umbrella exports to expose `core`.
- **Files**: `packages/evaluator/src/evaluate/*`, `packages/vestlang/src/index.ts`.
- **Checkpoint**: build + tests green on the new path only; no references to the removed engine remain.
- **Commit**: `feat!: remove legacy evaluator engine (clean break)`.

### Phase 6 — OCF-Tools migration *(separate repo + PR)*
- **Goal**: OCF-Tools consumes `@vestlang/core`; its duplicate engine is deleted.
- **Scope**: in `~/code/OCF-Tools`, delete `vesting_compiler/` + `types/canonical/vesting/`, depend on the **published `@vestlang/core`** (CJS entry), keep transaction cross-referencing; re-run its exact compiled-vs-recorded comparison.
- **Checkpoint**: OCF-Tools suite green against `@vestlang/core`, including a non-proportional-positional-cliff fixture (proves core carries fidelity the DSL doesn't express).
- **PR**: its own, dependent on `@vestlang/core` being published (Phase 7).

### Phase 7 — release
- **Goal**: ship the major and publish `@vestlang/core` standalone.
- **Scope**: changeset documenting the new standalone `@vestlang/core` package, the PORTION numeric change, and the reshaped `@nathamcrewott/vestlang` surface; publish `@vestlang/core` (under the `@vestlang` org from Phase 0) and `@nathamcrewott/vestlang` via changesets.
- **Commit**: `chore: release @nathamcrewott/vestlang vX + @vestlang/core (core/extended)`.

---

## Verification

- **Per phase**: `pnpm build && pnpm test` green; Phase 2 allocation-parity, Phase 3 conformance, Phase 4 lowering, Phase 5a differential gate.
- **MCP smoke test** (post Phase 5b): `vestlang_compile` → `vestlang_evaluate` on (a) monthly-over-48 with `CLIFF +12 months`; (b) event-gated `CLIFF LATER OF(+12mo, EVENT "ipo")` with and without the firing; (c) a multi-statement graded schedule. Totals telescope exactly to grant quantity; UNRESOLVED/blocker output matches pre-refactor.
- **Inferrer round-trip**: `vestlang_infer_schedule` → feed `dsl` + `diagnostics.{vestingDayOfMonth,allocationType}` back through `vestlang_evaluate`; residual error stays 0.
- **Cross-repo** (Phase 6): OCF-Tools' exact compiled-vs-recorded validator passes on existing fixtures + the non-proportional-cliff fixture.
