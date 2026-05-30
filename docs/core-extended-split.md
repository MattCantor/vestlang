# Core / Extended Split

Split vestlang into a `core` engine — the **Carta-aligned canonical interchange**, verbatim — and an `extended` layer that **authors, resolves, and classifies** vesting intent against that interchange. One vesting engine serves both vestlang and OCF-Tools; extended becomes the contingency front-end + inferrer + conformance classifier over it.

## Status

- **Status**: Design Specification — staged for implementation (see Implementation Phases).
- **Priority**: High
- **Complexity**: High
- **Spans**: `vestlang` (this repo) + `OCF-Tools` (`~/code/OCF-Tools`, branch `add-canonical-vesting-compiler`)
- **Interchange target**: Carta Cap Table Data Schema v1alpha1 (`~/code/OCF-Composed-Schemas/target-schema/Carta.schema.json`), which OCF-Tools' canonical formalizes.

---

## Overview

vestlang's evaluator and OCF-Tools' `vesting_compiler/` are cousins solving the same problem twice: DATE/EVENT anchoring, periodic installments, cliffs, cumulative-round-down, EOM clamping. This spec consolidates them into **one engine** — and, in doing so, fixes vestlang's product axis.

- **`core`** — the canonical interchange engine. Input is a fully-concrete, combinator-free canonical template (one hoisted start, ordered statements) + runtime + total shares; output is exact installments. This template **is** the proposed OCF interchange, shaped to track Carta's production schema. Independently consumable; **OCF-Tools depends on it directly, with zero translation**.
- **`extended`** — the DSL/parser front-end + a runtime-aware **resolver/classifier**. It resolves combinators (`LATER_OF`/`EARLIER_OF`, `AND`/`OR`, constraints, event-gated cliffs) against runtime, then **classifies the result by interchange fidelity**: a single canonical template when it fits, bare vesting events when it resolves but doesn't fit the template shape, or `UNRESOLVED`/`IMPOSSIBLE` + blockers when it can't be materialized yet. Core never sees a combinator, blocker, or symbolic date.

The split runs along a precise line — **substitute vs. resolve**. **Core *substitutes*:** given a fixed template, it plugs in runtime values (event firings, the start date), expands, and allocates exactly — deterministically, one template + runtime → one installment set. **Extended *resolves*:** combinators (`LATER_OF`/`EARLIER_OF`, gating, constraints) let runtime *select the structure itself*, projecting one DSL program to one of `{template | events | unresolved}`. Both read `runtime`; only extended makes choices with it — an EVENT statement is a *parameter* core fills, while a combinator is *logic over* parameters, which only extended has. This eliminates the duplicated engine and gives OCF-Tools a real reference implementation. Crucially, it reframes vestlang: **not** a structurally-richer schedule format (that can't survive the round-trip), but the **contingency front-end + inferrer + conformance classifier** that maps the interchange's own expressibility boundary — and falls back gracefully when a schedule lands outside it.

---

## Background & key decisions

The key decisions, with rationale.

### The interchange target is Carta's schema — and it does not allow superimposition

Core's `VestingScheduleTemplate` is **not** a private compile IR — it is the *proposed OCF interchange format*, deliberately shaped to track **Carta's production schema** (`target-schema/Carta.schema.json`, "Carta Cap Table Data Schema v1alpha1"). OCF's native `vesting_conditions` *graph* is the incumbent being improved on, not the target. Carta's shape settles the design:

- A grant's vesting references **one** template and **one** start date (`Vesting { templateId, startDate }`) — one schedule per grant.
- `VestingScheduleTemplate { vestingScheduleType: DATE|MILESTONE|HYBRID, periods: VestingPeriod[] }`; `periods` chain by `order`, each with its own cliff (`cliffPercentage`/`cliffLength`). This maps directly onto canonical's ordered `statements[]` + positional cliff.
- Event/milestone vesting is **structured** (`vestingScheduleType: MILESTONE|HYBRID`; `VestingPeriod.milestoneName`/`performanceCondition`), but every anchor is *atomic* — a chained date or a single named condition. There is no combinator over anchors (no "later of a date and an event") and no representation of the unresolved state. That combinatorial/contingent layer is the vestlang-shaped hole (see "The DSL's only axis over core").
- Multiple parallel/overlapping vesting streams are modeled as **multiple grants**, not a superimposition on one.

**Consequences that drive the rest of this spec:**

1. **No fan-out.** Resolving one program to *N* canonical templates produces something with no home in the interchange. The real cases all collapse to **one** template anyway: graded → ordered chained DATE statements; cliff → positional cliff; a time-vested portion **plus** a portion anchored to a named `EVENT` → a DATE statement plus a floating EVENT statement *in the same template*. Only genuine overlapping independent absolute starts don't fit — and those are multi-grant in Carta (see "Superimposition and the fidelity ladder" below).
2. **vestlang must hoist to a single start to round-trip structurally.** So it is *not* a structural superset of the interchange. Its value axis is **contingency / unresolved time**, which hoisting leaves fully intact (see "Core ⊇ DSL on arithmetic …" below).
3. **The interchange always accepts bare vesting events** (Carta `vestingEvents[]`; canonical's `{date, amount}[]` output) as a fallback. So extended classifies, rather than forces, every schedule into the interchange (see "Resolver output contract").

### The engine to keep is vestlang's, not OCF-Tools'

Core takes vestlang's engine, not OCF-Tools'. vestlang's evaluator is already a compiler, and the *more capable* one:

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

vestlang's wider convention space — the allocation mode and the vesting-day-of-month policy — rides on `runtime`/`EvaluationContext` as **additive, optional fields**, never on the template. The canonical template carries no field for either and assumes the defaults (allocation → `CUMULATIVE_ROUND_DOWN`; day-of-month → `VESTING_START_DAY_OR_LAST_DAY_OF_MONTH`, ≈ Carta's `SAME_DAY_AS_START_DATE`). So canonical/OCF data is a valid **subset** of core's input — the optional fields simply omitted — never a translation. These conventions are engine-internal (the inferrer searches them to recognize real data; the evaluator reproduces them), and any off-default convention is resolved-arithmetic that lands in events-only, not a structured template. **All** rich-AST→canonical adaptation lives in extended; that *is* extended's job.

> **Open question (under review in OCF-Composed-Schemas):** how large this convention catalogue should be — OCF's full spread (6 allocation modes; 32 day-of-month values) vs. Carta's narrower set (no allocation field; the 4-value `VestingOccurs`) vs. just the defaults. The catalogue size directly drives the inferrer's cost — both search time and decomposition ambiguity scale with it — so the engine treats it as **configurable** rather than hard-coding OCF's spread. Tentative working set pending resolution: the two cumulative allocation modes + Carta's `VestingOccurs`.

### The DSL's only axis over core is *unresolved intent* — never structure

Core and the DSL are expressive on different axes, and the split only works because the DSL's extra axis is **temporal contingency, not structure**:

- **Core is wider on resolved arithmetic**: non-proportional cliffs, arbitrary per-occurrence fractions. These are machine-data artifacts (existing ledgers, rounding, raw tranche arrays) — *humans don't author them*.
- **The DSL is wider on unresolved intent**: `LATER_OF`/`EARLIER_OF`, `AND`/`OR`, `BEFORE`/`AFTER`, combinator-gated cliffs. **Core is combinator-free and cannot represent any of these.** The gap is *not* event-gating — both core and Carta model event/milestone anchoring structurally, and a plain `cliff ON EVENT "ipo"` lowers fine. The gap is **combinators over anchors** — an anchor that is the *later of* a date and an event. The interchange holds an unresolved *atomic* condition fine: a canonical `EVENT` anchor pending its firing, or a Carta milestone with status `NOT_EVALUATED`. What it cannot hold is an unresolved **combinator** — a condition whose resolution *selects among different structures*. So a canonical template is a *value* (one fixed structure, pending holes and all); a DSL program is a **schedule-valued function of runtime** — `LATER_OF(12mo, EVENT "ipo")` resolves to a *different* template depending on which wins. The interchange has a slot for an unresolved hole; none for an unresolved choice of structure.

This axis survives hoisting completely. Hoisting to a single start constrains *structure*; it says nothing about whether the start is *known*. The hoisted start can be `LATER_OF(grant + 12mo, EVENT "ipo")` — canonical can only hold the value *after* you know which won; the DSL holds it before, across the multi-year span in which the events actually fire. That span — "schedule defined, runtime not yet known" — is the default state of equity, and the DSL owns all of it.

One DSL expression therefore resolves to **one** canonical template *or to a non-template fidelity level* depending on runtime (IPO fired → a concrete template; not fired → `UNRESOLVED` + blockers). That collapse-to-one-template-or-report is the whole reason extended exists. Mental model: **DSL = source language** (intent, contingency, ergonomics, lintable, the inferrer's target); **core = IR/interchange** (resolved, exact, validated, shared by multiple producers). Like C → assembly: the target being more restrictive does not make the source redundant — the source expresses what the target cannot *hold*.

What the DSL does **not** gain from this is a structural-superset axis. Extended still *evaluates* superimposed programs and produces correct dated amounts — nothing is rejected at authoring time. But a superimposition that doesn't fit one canonical template is **classified as `events-only`, with the reason**, rather than passed off as a structured schedule. The facts survive; the structural pretence does not. See "Superimposition and the fidelity ladder" for the taxonomy and why the events round-trip but the structure doesn't.

The DSL needs no new syntax for non-proportional cliffs: genuine non-proportional graded vesting is already expressible as **multiple PORTION statements** in one canonical template, and the proportional DSL cliff is simply core's `percentage = K/N` special case.

### Other reframes

- **"Extended never allocates" is unachievable.** Both non-template fidelity levels carry allocated amounts: `UNRESOLVED` installments carry an **amount with no date** (`packages/types/src/evaluation.ts`), and the **events-only** fallback emits dated amounts for schedules that resolve but don't fit the template. Resolution: **one allocator implementation**, exported from core as a pure primitive, called by *both* core's compiler and extended's events-only/unresolved rendering. One implementation, multiple call sites — no two allocators that can disagree.
- **The cliff fold and the grant-date fold are the same primitive.** `evaluateCliffGeneric<T>` (`packages/evaluator/src/evaluate/cliff.ts`) is parameterized; its three thin callers (`evaluateGrantDate`, `evaluateResolvedCliff`, `evaluateUnresolvedCliff`) all route through it. Off-grid cliffs reuse this fold / core's EVENT-anchor — **no separate cliff concept**.
- **Clean break.** The umbrella package is renamed from `@nathamcrewott/vestlang` to the unscoped **`vestlang`** (a new major). The resolver/assembler keeps the internal `@vestlang/evaluator` name (its API stays `evaluate*`); "core"/"extended" are layer terms.
- **Publishing end-state — one brand, one registry (npmjs).** Everything published reads as *vestlang*:
  - **`vestlang`** (unscoped) — the main package, replacing `@nathamcrewott/vestlang`. It inlines the internal packages but takes **`@vestlang/core` as a real external dependency**, so the engine ships once. **Blocked at present:** npm's typosquat filter rejects the unscoped name as "too similar to existing package `testling`" (403). Resolution is a support ticket (below); fallback if it never clears is **`@vestlang/vestlang`** as the umbrella — a cosmetic one-name change. This only bites at Phase 6, so it does not block Phases 1–5.
  - **`@vestlang/core`** — the standalone engine: public, dual CJS/ESM, the package OCF-Tools installs.
  - The other `@vestlang/*` packages (`types`, `evaluator`, `normalizer`, …) stay **private and inlined** into `vestlang` — never published, not import targets.

  Setup status (Phase 0): the **`@vestlang` org is registered on npmjs** (Free plan; publishing account `nathamcrewott`) and the GitHub-Packages registry mapping for the `@vestlang` scope is dropped (`.npmrc`). **`@vestlang/core` is unaffected by the typosquat filter** (scoped names skip the global similarity check — npm's own 403 message suggests a scoped name as the workaround) and is confirmed available; it is not placeholder-published since core doesn't exist until Phases 1–3 and a scope you own carries no squatting risk. The unscoped **`vestlang`** name is **pending** (typosquat block — see above; support ticket filed / fallback `@vestlang/vestlang`). Remaining Phase 6 wiring: configure `vestlang`'s `tsup` to mark `@vestlang/core` `external` (while still inlining the rest); deprecate `@nathamcrewott/vestlang` → `vestlang`. Release rides the existing changesets pipeline.

---

## Architecture

```
DSL string ──parse──► RawProgram ──normalizeProgram──► Program (rich AST)
                                                          │
                              extended: resolve combinators (runtime-aware), then CLASSIFY
                                                          │
                          ┌───────────────────────────────┼───────────────────────────────┐
                          ▼                                ▼                                ▼
                  TEMPLATE                          EVENTS-ONLY                     UNRESOLVED / IMPOSSIBLE
        fits canonical shape →             resolves but doesn't fit →        can't materialize yet →
        one { template, runtime }          bare {date,amount}[] + reason     blockers naming what's missing
                          │                          │ (allocator primitive)            │
              core: compile (exact rational)         │                                  │
                          ▼                          ▼                                  ▼
                          └──────────────────► assemble (tag by fidelity) ◄─────────────┘
                                                          │
                                                  EvaluatedSchedule

        OCF/Carta data ─────────────► core (same engine; positional cliffs incl. non-proportional)
```

Core never sees a blocker, combinator, or symbolic date. Extended owns the entire `UNRESOLVED`/`IMPOSSIBLE`/blocker vocabulary **and the fidelity verdict** — TEMPLATE (best; intent preserved), EVENTS-ONLY (facts preserved, intent lost, reason reported), or UNRESOLVED. The events-only level is the interchange's own bare-events escape hatch, surfaced honestly rather than disguised as a structured template.

### How core interprets a template (OCF semantics, verbatim)

Statements run in `order` against a `dateCursor = runtime.startDate`:

- **DATE** statement → expand `occurrences` events from the cursor, then advance the cursor by the full duration. This chaining is what makes graded (e.g. 5/15/40/40) schedules work in a canonical template. DSL-origin graded schedules **lower onto this path** — the resolver emits ordered chained statements in one template rather than fanning out (see "Resolver output contract" below).
- **EVENT** statement → expand at the matching firing's date from `runtime.eventFirings`; it **neither reads nor advances the cursor** (floats). This is principled and *necessary*: a firing is a runtime value, so you cannot statically chain a subsequent DATE statement through it — events must be excluded from chaining for the DATE chain to stay statically computable. (That same exclusion is what makes the synthetic-firing smuggle mechanically possible — see "Superimposition and the fidelity ladder".)

Consequence: `order` is a temporal chain for DATE statements but only identity/tie-break for EVENT statements. Unfired EVENT → statement skipped (extended classifies that portion as `unresolved` + blockers instead).

### Resolver output contract — classify, don't fan out

The resolver is a **classifier**: it resolves combinators against runtime, then maps the result to exactly one of three interchange-fidelity levels.

```ts
extended.resolve(program, runtime) → ResolveResult

type ResolveResult =
  // TEMPLATE — the program resolves AND fits canonical's one-template shape.
  // Structured round-trip; intent preserved. The best outcome.
  | { kind: "template", template: VestingScheduleTemplate, runtime: VestingRuntime, totalShares: number }

  // EVENTS-ONLY — the program resolves to concrete dated amounts but does NOT fit
  // the template shape (overlapping independent absolute starts; an allocation mode
  // the interchange lacks; an inferred tranche array that won't decompose). Emit the
  // bare vesting events the interchange always accepts, with the reason it couldn't
  // be a template. Facts preserved, intent lost — reported, not disguised.
  | { kind: "events", installments: ResolvedInstallment[], reason: NonTemplateReason }

  // UNRESOLVED / IMPOSSIBLE — can't be materialized yet (unfired event) or self-
  // contradictory. Carries allocated amounts with symbolic/absent dates + blockers.
  | { kind: "unresolved", symbolic: SymbolicInstallment[], blockers: Blocker[] }
```

A program collapses to **one** template, not N. Cursor chaining (DATE advances the cursor, EVENT floats) is core's canonical interface; the resolver *targets* it — a graded 5/15/40/40 lowers to ordered chained statements, and a time-vested portion + a portion anchored to a named `EVENT` lowers to a DATE statement plus a floating EVENT statement, both in the **same** template. Programs that genuinely can't fit one template drop to `events`, not to a multi-template fan-out.

The published `EvaluatedSchedule` is **assembled** from the verdict: `template` → core compile (RESOLVED installments); `events` → the resolved installments passed through, tagged events-only with the reason; `unresolved` → symbolic installments + blockers. `normalizeProgram` stays a pre-resolution pass; the resolver/classifier is a second pass after it.

### Superimposition and the fidelity ladder

"Two schedules on one grant" is three different things; only one is not template-expressible:

1. **Sequential / graded** — tiled DATE statements, chained by `order` (they hand off, never overlap). → `template`.
2. **A DATE-anchored portion + a portion anchored to a named `EVENT`** — e.g. `PORTION 75% MONTHLY OVER 48 MONTHS` (DATE) and `PORTION 25% ON EVENT "ipo"` (EVENT, `occurrences:1`). Different shares of the grant; the EVENT portion floats to its firing. One template holds both. → `template`.
3. **Two independent DATE-anchored time grids, both live at once** — the genuinely not-template-expressible case. → `events-only` (or model as multiple grants).

Extended does **not** forbid case 3 — it evaluates it and emits correct dated amounts. It only declines to dress the result up as a structured template. The reason that matters is a **two-level round-trip distinction**:

- **The events round-trip.** Case 3's `{date, amount}` installments survive through Carta's `OptionGrantVestingEvent[]` (`vestDate`) unchanged. The numbers are never at risk — that is exactly the `events-only` level.
- **The structure round-trips only as a lie.** A `VestingPeriod` can be timed two ways only: a duration chained off the single grant-level `Vesting.startDate`, or a milestone/performance condition. There is **no per-period absolute-date anchor** (verified: the only absolute dates in Carta's vesting model are `Vesting.startDate` and the materialized `vestDate`), and a grant carries exactly **one** `vestingScheduleTemplateId`. Two overlapping time grids can't both be chained DATE periods. So the *only* structured encoding of the second grid is a MILESTONE period — which mislabels pure calendar/service timing as **performance-conditioned**. That is not cosmetic: performance vs. service conditions carry different treatment (e.g. ASC 718 expense recognition), and on read-back you recover "a milestone that vested on 2026-01-01," never "a second time-based grid." The intent is unrecoverable.

**The synthetic-firing smuggle.** Because EVENT statements neither read nor advance the cursor, you *can* mechanically encode an independent absolute-date grid as an EVENT statement with a synthetic firing on that date — core will expand it faithfully. This is the abuse the classifier rejects: an EVENT firing is meant to denote a genuine named event, not a calendar anchor. **Policy: extended emits an EVENT statement only when the DSL names a real event (`EVENT "..."`), never to repackage an absolute `FROM DATE` start.** Core is not asked to police this (it faithfully expands whatever firings it's given); the Carta-fidelity judgment lives entirely in extended's classifier, which routes case 3 to `events-only`.

This *sharpens* the seam rather than weakening it: the gap isn't "vestlang computes things the interchange can't store" — it can store the events. It's "vestlang expresses *intent* (two independent time starts) that the structured template can only record by **misclassifying** it as performance-based." That mislabel is a concrete, defensible example of where the proposed interchange leaks.

### Cliff lowering (extended → core)

Extended resolves the cliff `VestingNodeExpr` (reusing `evaluateVestingNodeExpr`), then lowers:

- **Case A — cliff lands ON a grid boundary** (`d_K == cliffDate`): one core statement, `cliff: {occurrence: K, percentage: K/N}` (GCD-reduced `Fraction`). The only case the DSL produces.
- **Case B — cliff OFF-grid** (event-gated, or a date between boundaries): **two core statements within the same template** — a pre-cliff aggregate (a one-occurrence EVENT-anchored statement, `occurrences:1, period:0`, which floats; or a DATE statement at `cliffDate`) plus the post-cliff grid statement (`occurrences = N − m`). Both sit in one canonical template (one floats, one chains) — this is lowering, not fan-out, and stays a `kind: "template"` result.
- **Edge cases**: cliff after all occurrences → single `occurrences:1, period:0` statement at the cliff anchor (core's `Cliff.occurrence` can't exceed `occurrences`). Cliff before/at start → plain grid, no cliff. Unresolved cliff (e.g. unfired event with no resolvable alternative) → a `kind: "unresolved"` result emitting `UNRESOLVED_CLIFF` installments via the standalone allocator; a probed `LATER_OF` resolved tail lowers to a template normally.
- **Non-proportional cliffs** are never produced by the DSL path; they enter core only via OCF data, carried as an exact `Fraction` (never re-derived as `K/N`).

### Numerics

Core computes in exact `Fraction` and emits integer shares (`floorSharesAt` uses BigInt to avoid overflow). Two emit shapes off one engine: `compile(...) → {date, amount: string}[]` (OCF/Carta-native, for OCF-Tools) and `compileToInstallments(...) → {date, amount: number}[]` (for extended). 

**Allocation model.** Core allocates with a **single cumulative round-down across the whole ordered template** — one running `cumulative` fraction and `vestedSoFar`, so the schedule telescopes *exactly* to total shares (canonical's guarantee). The current evaluator instead rounds each PORTION on its own quantity (which need not sum to the grant); core's single-cumulative model supersedes it, and the clean break also fixes the latent PORTION rounding (`grantQuantity·(num/den)` in float → exact-rational-then-floor). Both numeric differences are deliberate and documented in the changeset; the Phase 5a gate validates these semantics rather than parity with the current engine.

---

## Scope

### Included

- New `packages/core` (dual CJS/ESM) = vestlang's engine over the Carta-aligned canonical IR.
- Rationalized single allocator (single cumulative round-down across the template; all 6 modes available), policy-aware date math (day-of-month, DST), positional cliff, structural/runtime validation.
- Extended resolver/**classifier** + lowering + assembler (fidelity ladder: template / events-only / unresolved); `@vestlang/evaluator` retains its `evaluate*` API.
- OCF-Tools repointed at `@vestlang/core` (its own commit/PR).
- Clean-break rename of the umbrella to unscoped **`vestlang`** (retiring `@nathamcrewott/vestlang`).

### Explicitly deferred

| Item | Why |
|---|---|
| `FRACTIONAL` allocation mode | Not in vestlang's `allocation_type` union; out of scope until the spec carries it. |
| Renaming `evaluator` → `extended` | "core"/"extended" stay as layer terms; renaming would desync from the `evaluate*` API. |
| Day-of-month / allocation fields in the *template* | They ride on `runtime` (additive-optional), so canonical templates stay verbatim. |
| Superimposing independent absolute starts on one grant | Not interchange-expressible (Carta models these as separate grants). Reported as `events-only` or pushed to multi-grant — never fanned out to N templates. |
| DSL syntax for structural superset over canonical | Out of scope by design: the DSL's only axis over core is unresolved intent, not structure. |

---

## Implementation Phases

Each phase keeps `pnpm build` + `turbo test` green and is a self-contained commit. Phase 7 is a separate repo and PR. The published umbrella surface (`@nathamcrewott/vestlang` → `vestlang`) is only intentionally reshaped at Phase 5b/6.

### Phase Dependencies

```
Phase 0 ──► 1 ──► 2 ──► 3 ──► 4a ──► 4b ──► 5a ──► 5b ──► 6 ──► 7
hygiene     core  core  core   resolve classify assembler retire  release  OCF-Tools
+ org reg   IR    eng   comp   +lower  fidelity +cutover  legacy  +publish (sep. repo)

Notes:
  • Phase 0's org registration is an external lead-time prerequisite consumed only at Phase 6 (release).
  • Phase 4a depends on Phase 3 (the core compile API it lowers to), not just Phase 1.
  • Phase 4b depends on 4a (it completes the ResolveResult union that 4a's lowering produces).
  • Phase 5a cuts the public path over to resolve/classify + core + assemble. Allocation
    semantics change deliberately (per-statement → single cumulative round-down), so the
    gate validates the NEW semantics via updated golden files + the telescoping property —
    it is NOT a parity diff against the old engine.
  • Phase 5b deletes the old engine once 5a is green on the new semantics.
  • Phase 7 lives in OCF-Tools and depends on the published @vestlang/core from Phase 6 (release).
```

---

### Phase 0 — Hygiene + publishing prerequisite

**Goal:** Remove cruft that would otherwise mask later moves; secure the publish target.

**Why First:** The deep cross-package imports and dead `packages/ast` would obscure the engine relocation in Phases 2–3; cleaning them now keeps later diffs legible. Registering the npm org is an external lead-time action that Phase 6 (release) depends on — start it early.

**Outputs:**
- `@vestlang/types` imports fixed in `cliff.ts`, `build.ts`, and `makeTranches.ts` (all three carry the deep `../../../types/dist/...` path).
- `apps/cli/package.json` `"workspace: *"` typo fixed.
- Dead `packages/ast` deleted, canonical JSON schemas first salvaged into core/docs.
- `@vestlang` org registered on npmjs (done; account `nathamcrewott`) and the GitHub-Packages registry mapping for the `@vestlang` scope dropped so everything targets npmjs (done). No code depends on these yet. **`@vestlang/core` available** (unaffected by the typosquat filter). The unscoped **`vestlang`** name is **blocked** by npm's typosquat filter ("too similar to existing package `testling`") — pending a support ticket; fallback `@vestlang/vestlang`. Consumed only at Phase 6.

**Definition of Done:**
- [x] `pnpm build` + `turbo test` green, no behavior change. *(build 12/12, test 16/16 — 129 tests passing.)*
- [x] No deep `../../../types/dist/...` imports remain. *(`EvaluatedSchedule` was already re-exported from `@vestlang/types`; the three deep imports now point at the package root.)*
- [x] `@vestlang` scope no longer mapped to GitHub Packages *(`@vestlang:registry` line removed from `.npmrc`)*; `@vestlang` org registered on npmjs (account `nathamcrewott`). **Still pending (external, consumed only at Phase 6):** the unscoped `vestlang` name is blocked by npm's typosquat filter (vs. `testling`) — support ticket filed; fallback `@vestlang/vestlang`. `@vestlang/core` is available and unaffected.
- [ ] Commit: `chore: fix cross-package imports and remove dead ast package`.

---

### Phase 1 — core foundation

**Goal:** `packages/core` skeleton with the IR and validation, no consumers yet.

**Inputs:**
- Clean cross-package imports from Phase 0.
- Reference shapes: `~/code/OCF-Tools/types/canonical/vesting/types.ts`, `vesting_compiler/validate.ts`.

**Outputs:**
- New `packages/core/**` with dual CJS/ESM tsup, packaged to publish standalone as `@vestlang/core` on npmjs (no `private`, `publishConfig` → npmjs registry + `access: public`).
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

### Phase 4a — resolve + lower to one template

**Goal:** Extended's resolver turns a resolvable, template-fitting program into a single canonical template — the `kind: "template"` arm of `ResolveResult`. Landed behind a new entry (not wired live).

**Inputs:**
- Phase 3 `compile` API (the lowering target).
- Existing selector layer: `selectors.ts`, `vestingNode/*`, `constraint.ts`.

**Outputs:**
- New `packages/evaluator/src/resolve/**` (depends on `@vestlang/core`).
- Combinator/constraint/event resolution reusing the selector layer.
- **Single-template lowering**: a resolved program → one canonical template (ordered chained DATE statements + floating EVENT statements). No fan-out.
- Cliff lowering: Case A (on-grid, single statement `{occurrence: K, percentage: K/N}`), Case B (off-grid → two statements in one template), and edge cases.
- `resolveToCore` returns `kind: "template"` for fitting programs (the `events`/`unresolved` arms land in 4b).

**Definition of Done:**
- [ ] Unit tests for cliff lowering (Cases A/B + edges) pass.
- [ ] A graded multi-statement program lowers to **one** template (verifies no fan-out).
- [ ] A fully-resolved, template-fitting program round-trips through `core.compile`.
- [ ] Not wired into the live public path yet.
- [ ] Commit: `feat(evaluator): runtime-aware resolver + single-template lowering`.

---

### Phase 4b — fidelity classification

**Goal:** Complete the `ResolveResult` union — the `events` and `unresolved` arms — so every resolved program gets a fidelity verdict.

**Inputs:**
- Phase 4a resolver (the `template` arm + lowering).

**Outputs:**
- **Fidelity classification**: detect schedules that resolve but don't fit the template shape → `kind: "events"` with a `NonTemplateReason`; unfired/contradictory → `kind: "unresolved"` with blockers/symbolic installments.
- Events-only and unresolved installments emitted via the core allocator primitive.

**Definition of Done:**
- [ ] A non-template-expressible program (e.g. overlapping independent absolute starts) classifies as `kind: "events"` with a reason.
- [ ] Partial-resolution cases (unfired-event, unresolved-cliff) → `kind: "unresolved"` with blockers.
- [ ] `ResolveResult` covers all three arms; still not wired into the live public path.
- [ ] Commit: `feat(evaluator): fidelity classification (events-only + unresolved)`.

---

### Phase 5a — assembler + cutover (behind a flag)

**Goal:** Route the public API through resolve/classify + core + assemble. The old in-evaluator engine stays reachable behind a flag for *revertability* during cutover — **not** for a parity comparison (the new semantics differ by design).

**Inputs:**
- Phase 4b resolver/classifier (the full `ResolveResult`).
- The still-present legacy engine (kept temporarily to de-risk the cutover).

**Outputs:**
- Assembler producing `EvaluatedSchedule` from the fidelity verdict: `template` → core compile (RESOLVED); `events` → resolved installments tagged events-only + reason; `unresolved` → symbolic installments + blockers.
- `evaluateStatement` / `evaluateProgram` / `evaluateStatementAsOf` flipped to call the new path.
- Old engine kept reachable behind an internal flag (no public-surface change yet).
- Golden files updated to the **new** allocation semantics (single cumulative round-down; exact-rational PORTION).

**Definition of Done (the gate):**
- [ ] Existing evaluator suite passes on the new path with golden files updated to the new semantics; every numeric change is intentional and traceable to (a) single-cumulative allocation or (b) exact-rational PORTION.
- [ ] Totals telescope **exactly** to grant quantity for every resolved (`template`) schedule.
- [ ] Fidelity classification asserted end-to-end: a template case, an events-only case (with reason), and an unresolved case each produce the right `EvaluatedSchedule` shape.
- [ ] Old path still exists behind the flag (revert safety).
- [ ] Commit: `feat: route evaluation through core engine (behind flag)`.

---

### Phase 5b — retire the legacy engine (clean break)

**Goal:** Delete the old in-evaluator engine and the flag once the gate is green; reshape the public surface.

**Inputs:**
- Green new-semantics gate from Phase 5a.

**Outputs:**
- Old `evaluateSchedule` / `allocateQuantity` / `evaluateCliff` allocation code and the internal flag deleted.
- Umbrella renamed `@nathamcrewott/vestlang` → `vestlang`; its `tsup` config marks `@vestlang/core` `external` (the rest still inlined); exports reshaped to expose `core`.

**Definition of Done:**
- [ ] build + tests green on the new path only.
- [ ] No references to the removed engine remain.
- [ ] Commit: `feat!: remove legacy evaluator engine (clean break)`.

---

### Phase 6 — release

**Goal:** Publish the consolidated `vestlang` namespace on npmjs and retire `@nathamcrewott/vestlang`.

**Inputs:**
- Phase 5b clean-break surface.
- `@vestlang` org (registered, Phase 0) + the unscoped `vestlang` name. **Precondition:** the unscoped name must clear npm's typosquat block (vs. `testling`) via support ticket. If it has not cleared by release, fall back to **`@vestlang/vestlang`** as the umbrella name (rename the one package; `@vestlang/core` is unaffected).

**Outputs:**
- Changeset documenting the new `@vestlang/core` package, the unscoped `vestlang` (replacing `@nathamcrewott/vestlang`), and the PORTION numeric change.
- `vestlang` + `@vestlang/core` published to npmjs via changesets; `@nathamcrewott/vestlang` deprecated, pointing at `vestlang`.

**Definition of Done:**
- [ ] `@vestlang/core` published to npmjs (CJS entry available for OCF-Tools).
- [ ] Umbrella published to npmjs as **`vestlang`** (if the typosquat block has cleared) **or** **`@vestlang/vestlang`** (fallback); `@nathamcrewott/vestlang` deprecated → whichever name shipped.
- [ ] Commit: `chore: release vestlang vX + @vestlang/core (core/extended)`.

---

### Phase 7 — OCF-Tools migration *(separate repo + PR)*

**Goal:** OCF-Tools consumes `@vestlang/core`; its duplicate engine is deleted.

**Inputs:**
- Published `@vestlang/core` (CJS entry) from Phase 6 (release).

**Outputs:**
- In `~/code/OCF-Tools`: `vesting_compiler/` + `types/canonical/vesting/` deleted.
- Dependency on the published `@vestlang/core`; transaction cross-referencing kept.
- Exact compiled-vs-recorded comparison re-run.

**Definition of Done:**
- [ ] OCF-Tools suite green against `@vestlang/core`.
- [ ] Includes a non-proportional-positional-cliff fixture (proves core carries fidelity the DSL doesn't express).
- [ ] PR opened in OCF-Tools, dependent on `@vestlang/core` being published (Phase 6).

---

## Phase Checklist

### Phase 0: Hygiene + publishing prerequisite
- [x] `packages/evaluator/src/evaluate/cliff.ts` — `@vestlang/types` import
- [x] `packages/evaluator/src/evaluate/build.ts` — `@vestlang/types` import
- [x] `packages/evaluator/src/evaluate/makeTranches.ts` — `@vestlang/types` import
- [x] `apps/cli/package.json` — `"workspace: *"` typo
- [x] `packages/ast` — salvage schemas (→ `docs/schemas/{oct-schema,vestlang}`), then delete; `@vestlang/ast` removed from `.changeset/config.json` ignore
- [x] Drop GitHub-Packages mapping for `@vestlang` scope (`.npmrc`)
- [x] External: register `@vestlang` org on npmjs (account `nathamcrewott`)
- [ ] External (pending, Phase 6): unscoped `vestlang` name blocked by typosquat filter (vs. `testling`) — support ticket; fallback `@vestlang/vestlang`. `@vestlang/core` available/unaffected.

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

### Phase 4a: resolve + lower to one template
- [ ] `packages/evaluator/src/resolve/index.ts` — `resolveToCore` (the `template` arm)
- [ ] `packages/evaluator/src/resolve/lower.ts` — resolved program → one canonical template
- [ ] `packages/evaluator/src/resolve/cliff.ts` — Cases A/B + edges

### Phase 4b: fidelity classification
- [ ] `packages/evaluator/src/resolve/classify.ts` — fidelity verdict + `NonTemplateReason`; `events`/`unresolved` arms (blockers + symbolic installments)
- [ ] `packages/evaluator/src/resolve/index.ts` — complete `ResolveResult` (template/events/unresolved)

### Phase 5a: assembler + cutover (behind a flag)
- [ ] `packages/evaluator/src/evaluate/*` — assembler (verdict → `EvaluatedSchedule`) + new-path wiring + internal flag
- [ ] `packages/vestlang/src/index.ts`
- [ ] `apps/mcp-server/src/server.ts` — imports
- [ ] Golden files updated to new allocation semantics; telescoping + classification assertions

### Phase 5b: retire the legacy engine (clean break)
- [ ] `packages/evaluator/src/evaluate/*` — delete legacy engine + flag
- [ ] `packages/vestlang/package.json` — rename `@nathamcrewott/vestlang` → `vestlang`; add `@vestlang/core` dependency
- [ ] `packages/vestlang/tsup.config.ts` — mark `@vestlang/core` `external` (inline the rest)
- [ ] `packages/vestlang/src/index.ts` — reshape umbrella exports

### Phase 6: release
- [ ] `.changeset/*` — `@vestlang/core`, `vestlang` (renamed from `@nathamcrewott/vestlang`), PORTION numeric change
- [ ] Publish `vestlang` + `@vestlang/core` to npmjs; deprecate `@nathamcrewott/vestlang` → `vestlang`

### Phase 7: OCF-Tools migration *(separate repo)*
- [ ] `~/code/OCF-Tools` — delete `vesting_compiler/` + `types/canonical/vesting/`
- [ ] `~/code/OCF-Tools/package.json` — depend on published `@vestlang/core`
- [ ] OCF-Tools fixtures — add non-proportional-positional-cliff fixture

---

## Verification

- **Per phase**: `pnpm build && pnpm test` green; Phase 2 allocator parity (`allocateExact` vs old `allocateQuantity`, per-mode, at the function level), Phase 3 conformance, Phase 4a single-template lowering, Phase 4b classification, Phase 5a new-semantics gate.
- **MCP smoke test** (post Phase 5b): `vestlang_compile` → `vestlang_evaluate` on (a) monthly-over-48 with `CLIFF +12 months` → `template`; (b) event-gated `CLIFF LATER OF(+12mo, EVENT "ipo")` with the firing (→ `template`) and without (→ `unresolved` + blockers); (c) a multi-statement graded schedule → **one** template; (d) a non-template-expressible schedule → `events-only` with a reason. Totals telescope exactly to grant quantity for every `template` result.
- **Inferrer round-trip**: `vestlang_infer_schedule` → feed `dsl` + `diagnostics.{vestingDayOfMonth,allocationType}` back through `vestlang_evaluate`; residual error stays 0.
- **Cross-repo** (Phase 7): OCF-Tools' exact compiled-vs-recorded validator passes on existing fixtures + the non-proportional-cliff fixture.
