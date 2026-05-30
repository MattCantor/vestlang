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
- `VestingScheduleTemplate { vestingScheduleType: DATE|MILESTONE|HYBRID, periods: VestingPeriod[] }`; `periods` chain by `order`, each with its own cliff (`cliffPercentage`/`cliffLength`/`cliffLengthUnit`). This maps directly onto canonical's ordered `statements[]` + **time-based cliff** (`{length, period_type, percentage}`, mirroring Carta's `cliffLength`/`cliffLengthUnit`/`cliffPercentage`).
- Event/milestone vesting is **structured** (`vestingScheduleType: MILESTONE|HYBRID`; `VestingPeriod.milestoneName`/`performanceCondition`), but every anchor is *atomic* — a chained date or a single named condition. There is no combinator over anchors (no "later of a date and an event") and no representation of the unresolved state. That combinatorial/contingent layer is the vestlang-shaped hole (see "The DSL's only axis over core").
- Multiple parallel/overlapping vesting streams are modeled as **multiple grants**, not a superimposition on one.

**Consequences that drive the rest of this spec:**

1. **No fan-out.** Resolving one program to *N* canonical templates produces something with no home in the interchange. The real cases all collapse to **one** template anyway: graded → ordered chained DATE statements; cliff → time-based cliff; a time-vested portion **plus** a portion anchored to a named `EVENT` → a DATE statement plus a floating EVENT statement *in the same template*. Only genuine overlapping independent absolute starts don't fit — and those are multi-grant in Carta (see "Superimposition and the fidelity ladder" below).
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
| Cliff | temporal fold | positional `{occurrence, percentage}` |
| Combinator-free IR shape | no (rich AST) | **yes (canonical template)** |
| Structural validation | no | **yes** |

So core takes **vestlang's implementation** (left column) and **OCF-Tools' three genuine wins** (right-column bolds): the canonical IR shape, exact-rational numerics, and structural/runtime validation. OCF-Tools' `compile.ts` becomes the **reference spec for the IR**, not shipped code.

The cliff is *not* on that list: OCF-Tools' positional `{occurrence, percentage}` cliff is a compiler convenience that **diverges from Carta**, whose cliff is time-based (`cliffLength`/`cliffLengthUnit`/`cliffPercentage`). Core uses a Carta-aligned **time-based cliff** `{length, period_type, percentage}` instead — which is also closer to vestlang's own temporal fold, and lets cliffs that don't land on an installment boundary lower without an occurrence index. See "Cliff representation and lowering" below.

### Core's interface is OCF canonical, verbatim — no bridge

Core's *interface* = OCF canonical exactly: hoisted `runtime.startDate`, DATE-cursor chaining, floating EVENT statements, time-based `{length, period_type, percentage}` cliff (Carta-aligned). **OCF data flows straight in; OCF-Tools has no adaptation to do** (modulo the cliff shape, which OCF-Tools adopts — see the cross-repo note in "Cliff representation and lowering"). Any divergence would force an OCF↔core bridge — exactly the duplicated translation layer we're deleting.

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

        OCF/Carta data ─────────────► core (same engine; time-based cliffs incl. non-proportional)
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

### Cliff representation and lowering (extended → core)

Core's cliff is **time-based** — `Cliff { length, period_type, percentage }`, matching Carta's
`cliffLength`/`cliffLengthUnit`/`cliffPercentage`. The cliff date is `length` `period_type`s
after the statement anchor; `percentage` of the statement vests there as a lump, and the
occurrences after the cliff split the remaining `1 − percentage`. Because it is a **duration,
not an occurrence index**, it handles cliffs that don't land on an installment boundary — there
is **no on-grid/off-grid split** for date cliffs, and on-grid cliffs reproduce the old positional
result exactly.

Extended resolves the cliff `VestingNodeExpr` (reusing `evaluateVestingNodeExpr` with a
`vestingStart` overlay; `probeLaterOf` for the LATER_OF best) to a concrete `cliffDate`, then:

- **Date / offset cliffs** (`CLIFF +12 months`, `CLIFF DATE …`) → `cliff = { length, period_type, percentage }`. The duration is the offset when the cliff is `vestingStart + duration`, else the day-count from anchor to `cliffDate`. `percentage` is the pre-cliff share (proportional `m/N`, GCD-reduced).
- **Event cliffs** (`CLIFF EVENT "ipo"`) → **not** a `cliff` field. Carta has no event anchor *on* the cliff (events gate at the period level via `milestoneName`/`performanceCondition`), and a time-based cliff is a duration — so an event cliff lowers **structurally** (a floating EVENT statement for the lump + the post-cliff grid), or falls to `events-only` when that doesn't fit one template. This is the genuinely-hard case, independent of the cliff-shape choice.
- **Unresolved cliff** (unfired event, no LATER_OF fallback) → a `kind: "unresolved"` result emitting `UNRESOLVED_CLIFF` installments via the standalone allocator; a probed `LATER_OF` resolved tail lowers normally.
- **Edges:** cliff at/after the last occurrence → lump only; cliff at/before start → plain grid, no cliff.
- **Non-proportional cliffs** are never produced by the DSL path; they enter core only via OCF/Carta data, carried as an exact `Fraction`.

> **Design note (2026-05): positional → time-based cliff.** Core originally used OCF-Tools'
> positional `{occurrence, percentage}` cliff. That was a **departure from Carta** (whose cliff is
> time-based) and the root cause of an off-grid date-cliff problem — a positional cliff can only
> point at a grid boundary, so a cliff between installments had no home. Switched to the time-based
> shape: Carta-faithful, off-grid date cliffs lower trivially, and it matches the DSL (`CLIFF +12
> months` is already a duration). On-grid results are unchanged, so numerics don't regress.
> **Cross-repo:** [OCF-Composed-Schemas#118](https://github.com/Open-Cap-Table-Coalition/OCF-Composed-Schemas/issues/118)
> proposes moving the canonical cliff to time-based; OCF-Tools PRs
> [#143](https://github.com/Open-Cap-Table-Coalition/OCF-Tools/pull/143) (standalone compiler) and
> [#144](https://github.com/Open-Cap-Table-Coalition/OCF-Tools/pull/144) (validator integration) were
> closed in favour of importing `@vestlang/core` (the Phase-7 migration).

### Numerics

Core computes in exact `Fraction` and emits integer shares (`floorSharesAt` uses BigInt to avoid overflow). Two emit shapes off one engine: `compile(...) → {date, amount: string}[]` (OCF/Carta-native, for OCF-Tools) and `compileToInstallments(...) → {date, amount: number}[]` (for extended). 

**Allocation model.** Core allocates with a **single cumulative round-down across the whole ordered template** — one running `cumulative` fraction and `vestedSoFar`, so the schedule telescopes *exactly* to total shares (canonical's guarantee). The current evaluator instead rounds each PORTION on its own quantity (which need not sum to the grant); core's single-cumulative model supersedes it, and the clean break also fixes the latent PORTION rounding (`grantQuantity·(num/den)` in float → exact-rational-then-floor). Both numeric differences are deliberate and documented in the changeset; the Phase 5a gate validates these semantics rather than parity with the current engine.

---

## Scope

### Included

- New `packages/core` (dual CJS/ESM) = vestlang's engine over the Carta-aligned canonical IR.
- Rationalized single allocator (single cumulative round-down across the template; all 6 modes available), policy-aware date math (day-of-month, DST), time-based cliff (Carta-aligned), structural/runtime validation.
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
- Canonical IR types: `VestingScheduleTemplate`, `VestingStatement`, time-based `Cliff` (`{length, period_type, percentage}`), `Fraction`, `PeriodType`, `VestingRuntime` (incl. additive-optional `vestingDayOfMonth`/allocation). *(Cliff switched from positional to time-based in the 2026-05 redesign — see "Cliff representation and lowering".)*
- Ported `validate.ts` (template + runtime halves).

**Definition of Done:**
- [x] core builds + tests pass in isolation; nothing else imports it. *(tsup emits ESM `index.js` + CJS `index.cjs` + `index.d.ts`/`.d.cts`; 17 validator tests green; `grep` confirms no other package depends on `@vestlang/core`.)*
- [x] Package is configured to publish standalone (private dropped, public access). *(`publishConfig` → npmjs registry + `access: public`; no `private` field.)*
- [ ] Commit: `feat(core): canonical IR types + structural/runtime validation`.

**Implementation notes:**
- **tsup introduced** for core (rest of repo builds with `tsc`) to get the dual CJS/ESM + `.d.ts` output in one step — OCF-Tools is a confirmed CommonJS consumer (`package.json` has no `"type"`, `tsconfig` `module: CommonJS`), so the CJS entry is required, not optional.
- **Core is self-contained** — `AllocationType`/`VestingDayOfMonth` are defined locally in `types.ts` (mirroring `@vestlang/types`' `allocation_type`/`vesting_day_of_month`); core imports no other vestlang package, so it ships dependency-free.
- Core's `tsconfig` uses the base `Bundler` moduleResolution (not the per-package `NodeNext` override) since tsup bundles — avoids needing `.js` import extensions in source.
- `ISO_DATE_PATTERN` is inlined in `validate.ts`; Phase 2's `dates.ts` will own it.

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
- [x] Parity tests: rationalized output equals old `allocateQuantity` across all 6 modes. *(Loaded modes match the legacy expected values exactly; cumulative modes match where float and rational agree, and stay exact + telescoping at large magnitudes where legacy float drifts.)*
- [x] Date math (day-of-month, DST) unchanged vs. legacy. *(Day-of-month policy, DST-boundary `addDays`, and `lt/gt/eq` cases ported from the legacy time tests; plus a new `YEARS` case.)*
- [ ] Commit: `feat(core): port vestlang allocator + date math (exact rational)`.

**Implementation notes:**
- **Allocator split:** `allocateExact` (per-step cumulative telescoping primitive — round-down/rounding via BigInt `floorSharesAt`/`roundSharesAt`) + `allocateVector` (N-way split, all 6 modes; cumulative modes loop `allocateExact`, loaded modes are verbatim integer base+remainder). `CUMULATIVE_ROUNDING` is exact round-half-up: `floor((2p+q)/2q)`.
- **No `date-fns` in core** — ISO `YYYY-MM-DD` sorts lexicographically, so `lt/gt/eq` are string comparisons; core stays runtime-dependency-free.
- **`vestingDayOfMonth` is a direct param** (default `VESTING_START_DAY_OR_LAST_DAY_OF_MONTH`), not read off an `EvaluationContext`; `addPeriod` adds `YEARS` (= months×12).
- **`fold.ts` is the generic primitive only** — `foldByCliffDate<T>` (relocated `evaluateCliffGeneric`) + `foldToGrantDate`; blocker/installment-producing callers stay in the evaluator.
- **Parity by literals, not cross-import** — tests reuse the legacy tests' expected values rather than importing `@vestlang/evaluator`, keeping core self-contained. The legacy engine is untouched (lives until Phase 5b).
- 56 core tests green; build emits ESM/CJS/dts; no other package imports core.

---

### Phase 3 — core compile

**Goal:** The `compile` / `compileToInstallments` entry points over the IR.

**Inputs:**
- Phase 2 allocator primitive + date math + fold.

**Outputs:**
- `packages/core/src/compile.ts`: statement expansion (DATE cursor + EVENT firings), chronological sort, rational cumulative allocation, time-based cliff expansion (date-aware — lump at `anchor + cliff.length`, post-cliff on grid), grant-date fold, EVENT-unfired skip.
- Dual emit: `compile(...) → {date, amount: string}[]` (OCF-native) and `compileToInstallments(...) → {date, amount: number}[]` (extended).
- OCF-Tools' `vesting_compiler/__tests__` ported as core conformance tests.

**Definition of Done:**
- [x] core compiles representative DATE/EVENT/cliff templates. *(graded 5/15/40/40 chaining, cliff, hybrid DATE+EVENT, EVENT firings + realized_fraction, grant-date implicit cliff — 35 compile tests.)*
- [x] Totals telescope exactly to total shares. *(`sumAmounts === totalShares` asserted across the suite, including awkward share counts and CUMULATIVE_ROUNDING.)*
- [x] Conformance tests (ported from OCF-Tools) pass. *(the reference's own `compile.test.ts` ported verbatim onto core's `compile`; all green.)*
- [ ] Commit: `feat(core): canonical compile (dual numeric/OCF emit)`.

**Implementation notes:**
- **Core's compiler = vestlang's engine over the canonical IR.** The orchestration (expand→sort→cumulative→grant-fold) follows OCF's `compile.ts` as the reference for the IR semantics, but every primitive it calls is vestlang's (Phase 2 `allocateExact`, `addPeriod`, `foldToGrantDate`). OCF's `compile.ts` is reference-only — never shipped/imported.
- **Cliff handling** is date-aware `expandAnchored` (the positional `perEventGrantFractions` was later replaced by the time-based cliff — see the 2026-05 design note); vestlang's temporal fold is still used for the grant-date implicit cliff.
- **Grant-date fold reuses `foldToGrantDate`** instead of OCF's inline `pendingPreGrant` loop — verified equivalent across all cases (pre-grant hold, on-grant merge, past-grant flush, all-before-grant). This is the doc's "cliff fold and grant-date fold are the same primitive."
- **Dual emit:** `compile(...) → {date, amount: string}[]` (`CompiledEvent`, OCF/Carta-native) and `compileToInstallments(...) → {date, amount: number}[]` (`CompiledInstallment`). Signature `(template, totalShares, runtime)` matches OCF's arg order for zero-translation at Phase 7.
- **Runtime conventions threaded:** `vestingDayOfMonth` into the date stepper, `allocationType` into the allocator (default `CUMULATIVE_ROUND_DOWN`; `CUMULATIVE_ROUNDING` also telescopes). Loaded modes aren't template-compilable (extended's events-only path).
- 91 core tests green (35 compile); build emits ESM/CJS/dts; no consumers; dependency-free. Conformance suite landed in `tests/` (core convention), not the checklist's `__tests__/`.

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
- Cliff lowering: resolve the cliff date → time-based `cliff = {length, period_type, percentage}` (no on-grid/off-grid split for date cliffs); event cliffs lower structurally or fall to events-only; edge cases (cliff past end / at-or-before start).
- `resolveToCore` returns `kind: "template"` for fitting programs (the `events`/`unresolved` arms land in 4b).

**Definition of Done:**
- [x] Unit tests for cliff lowering pass. *(time-based: on-grid → `{length:12, period_type:MONTHS, percentage:1/4}`, off-grid date → DAYS fallback, event cliff → `EVENT`, before-start → `NONE`, unresolved → blockers. The positional Case A/B split is gone — see the cliff redesign.)*
- [x] A graded multi-statement program lowers to **one** template (verifies no fan-out). *(5/15/40/40 → one template, 4 chained DATE statements.)*
- [x] A fully-resolved, template-fitting program round-trips through `core.compile`. *(monthly-48+cliff → 37 events; graded → 5/15/40/40; EVENT portion → firing. 13 resolve tests.)*
- [x] Not wired into the live public path yet. *(`resolveToCore` lives in `src/resolve/`, not exported from the package index.)*
- [ ] Commit: `feat(evaluator): runtime-aware resolver + single-template lowering`.

**Implementation notes:**
- `resolve/lower.ts`: `resolveStatements` (reuses `evaluateScheduleExpr`) + `buildTemplate`; `amountToFraction` (QUANTITY `v` → `{v, totalShares}`). Independent-start statements → chained canonical via a cursor + `eq` check; non-chaining → the `events` verdict (4b).
- `resolve/cliff.ts`: `lowerCliff` → time-based `{length, period_type, percentage}` (`measureDuration` prefers the statement unit, falls back to exact DAYS); event cliff → `EVENT`; unresolved → blockers. Day-of-month threaded so it matches resolution + compile.
- `resolve/index.ts`: `resolveToCore` returns the `template` arm; non-template throws a sentinel (4b replaces it with the classifier). Added `@vestlang/core` dep; exported `createEvaluationContext`.

---

### Phase 4b — fidelity classification

**Goal:** Complete the `ResolveResult` union — the `events` and `unresolved` arms — so every resolved program gets a fidelity verdict.

**Inputs:**
- Phase 4a resolver (the `template` arm + lowering).

**Outputs:**
- **Fidelity classification**: detect schedules that resolve but don't fit the template shape → `kind: "events"` with a `NonTemplateReason`; unfired/contradictory → `kind: "unresolved"` with blockers/symbolic installments.
- Events-only and unresolved installments emitted via the core allocator primitive.

**Definition of Done:**
- [x] A non-template-expressible program (e.g. overlapping independent absolute starts) classifies as `kind: "events"` with a reason. *(two non-chaining DATE grids → `events` + `OVERLAPPING_ABSOLUTE_STARTS`; installments dated + telescoping. Event cliffs → `EVENT_CLIFF`.)*
- [x] Partial-resolution cases (unfired-event, unresolved-cliff) → `kind: "unresolved"` with blockers. *(unfired-event start → `EVENT_NOT_YET_OCCURRED`; LATER_OF-over-unfired-events cliff → blockers.)*
- [x] `ResolveResult` covers all three arms; still not wired into the live public path. *(`resolveToCore` returns template/events/unresolved; not exported from the package index. 72 evaluator tests.)*
- [ ] Commit: `feat(evaluator): fidelity classification (events-only + unresolved)`.

**Implementation notes:**
- `resolve/classify.ts`: `eventsArm` expands each resolved statement to dated events (`expandResolution`, mirroring core's cliff-aware expansion — incl. a fired event cliff's lump), flattens + sorts + allocates with the single running cumulative (`allocateExact`) → `ResolvedInstallment[]`. `unresolvedArm` reuses the legacy `evaluateStatement` to produce the symbolic (dateless) installments + blockers.
- `NonTemplateReason`: `OVERLAPPING_ABSOLUTE_STARTS` | `EVENT_CLIFF`. `buildTemplate` carries the reason; `resolveToCore`'s sentinel throw is replaced by `classify`.

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
- [x] Existing evaluator suite passes on the new path with golden files updated to the new semantics; every numeric change is intentional and traceable to (a) single-cumulative allocation or (b) exact-rational PORTION. *(No golden changes were needed: at the suite's magnitudes exact-rational matches the legacy float, and loaded modes reuse the same integer base+remainder arithmetic. Full repo green — build 13/13, test 18/18, incl. 41 inferrer + 113 integration.)*
- [x] Totals telescope **exactly** to grant quantity for every resolved (`template`) schedule. *(asserted in `assemble.test.ts`.)*
- [x] Fidelity classification asserted end-to-end: a template case, an events-only case (with reason), and an unresolved case each produce the right `EvaluatedSchedule` shape. *(`assemble.test.ts`: template = monthly-48+cliff; events-only = overlapping starts **and** a loaded allocation mode; unresolved = unfired event.)*
- [x] Old path still exists behind the flag (revert safety). *(`__useLegacyEngine(true)` returns the legacy untagged schedule; default is the new path.)*
- [ ] Commit: `feat: route evaluation through core engine (behind flag)`.

**Implementation notes:**
- **Fidelity tag is additive.** `EvaluatedSchedule` gained optional `fidelity` (`"template" | "events-only" | "unresolved"`) + `reason?: string` (`packages/types/src/evaluation.ts`). Optional ⇒ no public-surface break; the legacy engine leaves them undefined.
- **Per-statement vs whole-program.** Every consumer (`mcp-server`, `cli`, `inferrer`, `asof`) maps `evaluateStatement` per statement, and `evaluateProgram` has no callers. So `evaluateStatement(stmt)` routes a *one-statement* program through resolve→classify→assemble (per-statement contract preserved), while `evaluateProgram(program)` collapses the whole program to **one** schedule (single cumulative across the ordered template), returned as a one-element array — signature unchanged, semantics documented.
- **Grant-date fold via runtime.** `buildTemplate` now threads `ctx.events.grantDate` into `VestingRuntime.grantDate` so core's implicit grant-date cliff fires (the legacy `evaluateGrantDate` equivalent). Safe for the 4a/4b round-trip tests (there `grantDate === startDate`, nothing folds).
- **Loaded allocation modes → events-only (carried forward from 4b).** The inferrer searches all 6 allocation modes; the cumulative-only `compile` path threw on the four loaded modes. Fix: `buildTemplate` routes a loaded `allocation_type` to `events` (`NonTemplateReason: LOADED_ALLOCATION`), and `classify`'s new `loadedEventsArm` allocates each statement independently via `allocateVector` (the exact integer base+remainder that matches the legacy allocator), folding the grant-date and cliff lumps with `foldToGrantDate`. This keeps the inferrer on the one unified engine.
- **No cycle:** `evaluate/index.ts` imports `resolveToCore`/`assemble` from `../resolve/*`; the classifier imports the legacy `evaluateStatement` from `../evaluate/build.js` directly (not the index), so redefining the public entry points doesn't recurse.

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
- [ ] Includes a non-proportional-cliff fixture (proves core carries fidelity the DSL doesn't express).
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
- [x] `packages/core/package.json` — dual CJS/ESM tsup, public publishConfig
- [x] `packages/core/src/types.ts` — canonical IR types
- [x] `packages/core/src/validate.ts` — template + runtime validation

### Phase 2: core engine
- [x] `packages/core/src/allocate.ts` — 6 modes on `Fraction`; `allocateExact` + `allocateVector`
- [x] `packages/core/src/dates.ts` — `addMonthsRule` / `addDays` + `vestingDayOfMonth`
- [x] `packages/core/src/fractions.ts`
- [x] `packages/core/src/fold.ts` — cliff/grant-date fold mechanics

### Phase 3: core compile
- [x] `packages/core/src/compile.ts` — `compile` + `compileToInstallments`
- [x] `packages/core/tests/compile.test.ts` — ported OCF-Tools conformance tests *(`tests/`, not `__tests__/`)*

### Phase 4a: resolve + lower to one template
- [x] `packages/evaluator/src/resolve/index.ts` — `resolveToCore` (the `template` arm)
- [x] `packages/evaluator/src/resolve/lower.ts` — resolved program → one canonical template
- [x] `packages/evaluator/src/resolve/cliff.ts` — time-based cliff lowering + edges

### Phase 4b: fidelity classification
- [x] `packages/evaluator/src/resolve/classify.ts` — fidelity verdict + `NonTemplateReason`; `events`/`unresolved` arms (blockers + symbolic installments)
- [x] `packages/evaluator/src/resolve/index.ts` — complete `ResolveResult` (template/events/unresolved)

### Phase 5a: assembler + cutover (behind a flag)
- [x] `packages/evaluator/src/resolve/assemble.ts` — assembler (verdict → tagged `EvaluatedSchedule`)
- [x] `packages/evaluator/src/evaluate/index.ts` — new-path wiring (`evaluateStatement`/`evaluateProgram`) + internal `__useLegacyEngine` flag
- [x] `packages/types/src/evaluation.ts` — additive `fidelity`/`reason` on `EvaluatedSchedule`
- [x] `packages/evaluator/src/resolve/{lower,classify,types}.ts` — `grantDate` into runtime; loaded-allocation → events-only (`LOADED_ALLOCATION` + `loadedEventsArm`)
- [x] `packages/vestlang/src/index.ts` *(re-exports unchanged — same `evaluate*` names)*
- [x] `apps/mcp-server/src/server.ts` — `vestlang_evaluate` surfaces `fidelity`/`reason`
- [x] Telescoping + classification assertions (`packages/evaluator/tests/assemble.test.ts`); no golden updates needed (new semantics matched legacy at suite magnitudes)

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
- [ ] OCF-Tools fixtures — add non-proportional-cliff fixture

---

## Verification

- **Per phase**: `pnpm build && pnpm test` green; Phase 2 allocator parity (`allocateExact` vs old `allocateQuantity`, per-mode, at the function level), Phase 3 conformance, Phase 4a single-template lowering, Phase 4b classification, Phase 5a new-semantics gate.
- **MCP smoke test** (post Phase 5b): `vestlang_compile` → `vestlang_evaluate` on (a) monthly-over-48 with `CLIFF +12 months` → `template`; (b) event-gated `CLIFF LATER OF(+12mo, EVENT "ipo")` with the firing (→ `template`) and without (→ `unresolved` + blockers); (c) a multi-statement graded schedule → **one** template; (d) a non-template-expressible schedule → `events-only` with a reason. Totals telescope exactly to grant quantity for every `template` result.
- **Inferrer round-trip**: `vestlang_infer_schedule` → feed `dsl` + `diagnostics.{vestingDayOfMonth,allocationType}` back through `vestlang_evaluate`; residual error stays 0.
- **Cross-repo** (Phase 7): OCF-Tools' exact compiled-vs-recorded validator passes on existing fixtures + the non-proportional-cliff fixture.
