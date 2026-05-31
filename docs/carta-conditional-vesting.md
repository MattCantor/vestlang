# Conditional Vesting as an OCF Extension

How vestlang's three fidelity verdicts are really statements about *which canonical layer can hold
a schedule*; how a contingent (combinator-gated) schedule can still round-trip as a canonical
`template` by externalizing its gate to a **synthetic event** plus a **source map**; and why the
home for that source map is a **governed, namespaced `ext` channel** on canonical — making vestlang
the first worked example of an OCF-core extension mechanism.

## Status

- **Status**: Design Specification (concept-level) — supersedes the earlier Carta-centric draft and
  substantially expands the in-review fidelity draft. **Also a proposal *to* canonical / OCF** (the
  `ext` channel; restoring `comments`).
- **Priority**: High (carries the OCTC summit narrative).
- **Complexity**: High.
- **Interchange target**: OCF **canonical** (`~/code/OCF-Composed-Schemas/canonical/`) — the
  proposed "OCF-core" vesting model that itself maps down to Carta Cap Table Data Schema
  **v1alpha1**. Canonical is the target; **Carta is downstream**.
- **Relates to**: `docs/core-extended-split.md` (the fidelity ladder this revises in two places),
  `docs/simple-vesting-spec.md`, `docs/carta-vesting-question-email.md` (the one open Carta
  export-mapping question).

---

## Overview

This doc carries three threads, in dependency order:

1. **Fidelity is a property of the spec, not the projection (Case 1).** An EVENT-anchored statement
   is a valid `template` whether or not its event has fired. "Pending" is not a field — it is the
   absence of a firing witness. The simple unfired event was *miscategorized* as `unresolved`; it is
   a `template`.
2. **Contingent schedules can be templates too (Case 2).** A combinator *over anchors* with a fixed
   downstream grid (e.g. `LATER OF(+12mo, EVENT "ipo")` as a start) selects an **anchor**, not a
   **structure** — so it can lower to one canonical `template` by externalizing the gate as a
   **synthetic event**. The combinator's meaning travels in a **source map** (`event_id → DSL`)
   beside the template, and **rehydration = re-resolution → witness**.
3. **The source map needs a governed home → the OCF `ext` channel.** Canonical can't hold the
   combinator's meaning today (it's `additionalProperties: false`, and `VestingBaseEvent`
   deliberately keeps the event's meaning out-of-band). The fix is a namespaced, ignorable extension
   channel on canonical. This makes vestlang the **charter example** of the OCF-core + opt-in
   extensions architecture — the meta-theme of the OCTC summit, where Carta's read model is being
   renormalized into an "OCF core" that members extend selectively.

The arc: **hold the spec if you can (Cases 1 & 2); fall back to the dated projection; report
inexpressible only when both fail** — and carry the contingency that core can't hold in an
extension that core consumers safely ignore.

---

## Part I — Fidelity is a property of the spec (Case 1)

### The layer the verdict belongs to

Canonical (per its README) is **spec + runtime + projection**:

- **Spec** — `VestingScheduleTemplate` / `VestingStatement`; `vesting_base: DATE | EVENT { event_id }`. The rule, grant-independent.
- **Runtime** — `TX_CANONICAL_VESTING_START` (the date anchor) and `TX_CANONICAL_VESTING_EVENT` (a firing *witness*).
- **Projection** — OCF `Vesting { date, amount }`. The compiled output.

Fidelity asks "can the interchange hold this schedule's *shape*?" — a question about the **spec**.
vestlang currently answers it from the **projection**: it tries to compute installments, and when an
event hasn't fired it returns symbolic/blocked ones and tags the whole schedule `unresolved`. But an
incomplete projection doesn't mean an inexpressible spec. Trace an unfired event through the three
layers:

- **Spec:** the EVENT statement is present and valid. The template needs no runtime to *be* valid.
- **Runtime:** no witness has arrived.
- **Projection:** nothing is emitted for that tranche — `{date, amount}` requires a date it lacks.

So "this portion vests on event X, which hasn't fired" is fully expressed by *(EVENT statement) +
(no witness)*. There is **no "pending" field anywhere, by design — pending is the absence of a
fact.** Classifying on the projection conflates **"not realized yet"** with **"not representable."**

(This is the same read-model-vs-spec confusion seen on the Carta side: Carta's condition object fuses
the *rule* with its *evaluation status* because it's an API read model. vestlang must not import that
fusion.)

### The three fidelity levels = three ways canonical can hold a grant

| vestlang fidelity | Canonical representation | What lives here |
|---|---|---|
| **`template`** | the grant references a `VestingScheduleTemplate` (the spec) | time-based schedules **and** atomic event-anchored ones (EVENT statements). The projection fills in as `TX_CANONICAL_VESTING_EVENT`s arrive. **Plus contingent schedules via Case 2.** |
| **`events-only`** | the materialized `vestings` array (OCF `Vesting {date, amount}`) | resolved and dated but doesn't fit one template: overlapping absolute starts, a loaded allocation mode |
| **`unresolved` / impossible** | neither | a combinator that won't resolve *to one structure*, a self-contradiction |

Read top to bottom it's a ladder: hold the **spec** if you can; fall back to the **dated
projection**; report inexpressible only when both fail. The atomic unfired event sits at the **top**
— it has a spec — even though its projection is empty so far.

### Verified: where this bites in the current code

Both claims the earlier draft flagged "needs verification" are now **confirmed against the worktree**:

- `resolve/lower.ts:182` — `buildTemplate` returns the `unresolved` arm the moment **any** statement's
  start isn't `RESOLVED` (`resolutions.some((r) => r.start.state !== "RESOLVED")`). An unfired EVENT
  start fails `isPickedResolved` and lands in the `UNRESOLVED` branch (`lower.ts:117–130`), so an
  atomic unfired event forces `unresolved` — even though core's template model doesn't need the
  firing.
- `core/compile.ts:166` returns `null` for an EVENT statement with no matching firing, and `:201`
  skips past it. So a template containing an unfired EVENT statement **compiles fine** — it just emits
  nothing for that statement. The reclassification is mechanically sound: lower an EVENT-anchored
  statement into the template with its `event_id` and **no resolved date**, leaving the firing to
  runtime.

### The HYBRID bug this exposes (facts lost, not just intent)

The atomic empty-projection case is the *mild* version. The damaging one is a **HYBRID**: a
DATE-anchored portion vesting *now* **plus** an unfired EVENT portion — e.g.
`PORTION 75% MONTHLY OVER 48` (DATE) and `PORTION 25% ON EVENT "ipo"` (EVENT). Today `lower.ts:182`'s
`some()` check means the unfired EVENT poisons the **whole** program to `unresolved`, so the
already-vesting, fully-dated DATE installments are hidden too. That is **realized facts lost behind an
`unresolved` verdict**, not merely intent lost. (Verified empirically against this branch: the
4,800-share hybrid above — `75% MONTHLY OVER 48` from 2025-01-01 + `25% ON EVENT "ipo"`, evaluated
as-of 2035 with `ipo` unfired — returns `fidelity: unresolved` with **0 dated installments**; all
3,600 already-vested time-based shares are dropped, leaving one dateless symbolic installment for the
25%.) Classifying on the spec fixes this: the DATE portion
resolves and dates; the EVENT portion floats pending its witness; the schedule is a `template`.

### The atomic-vs-combinator boundary

The boundary for Case 1 is **atomic condition vs. combinator**, and it's already enforced structurally
in the resolver (`startBase`/`firstSchedule` only treat a bare `SINGLETON` EVENT as base-EVENT). The
genuinely non-template cases:

| construct | why | lands as |
|---|---|---|
| **Atomic event** — `EVENT "ipo"` | canonical-native EVENT statement | **`template`** (Case 1) |
| **Combinator over anchors** — `LATER OF(+12mo, EVENT "ipo")` | canonical has no combinator… | **`template`** *if it selects an anchor* (Case 2, Part II); else `unresolved` |
| **Event-anchored cliff** — `CLIFF EVENT "ipo"` | canonical/Carta cliffs are duration-only | `events-only` / structural re-expression |

> This revises `core-extended-split.md:131` ("Unfired EVENT → … `unresolved` + blockers") — an
> unfired atomic EVENT is now a `template`. (These design docs are working scratch; the sibling is not
> edited — the revision is named here so we don't trip over it mid-build.)

---

## Part II — Contingent schedules can be templates too (Case 2)

### The insight: a combinator over anchors selects an *anchor*, not a *structure*

`core-extended-split.md:76` argues combinators can't be templates because
`LATER OF(12mo, EVENT "ipo")` "resolves to a *different template* depending on which wins." That is
**overstated for a start anchor**: the occurrences/period/percentage downstream are identical
regardless of which arm wins — only the *anchor date* moves. A fixed structure with a single deferred
anchor is exactly what a named event models. So the ladder is finer than the sibling draws:

- **Combinator that collapses to one anchor** (a date or a condition) with a fixed downstream grid →
  **`template`**, by externalizing the anchor as a **synthetic event** + a source-map definition.
- **Combinator that genuinely selects among different structures** (different occurrences /
  percentages) → stays `unresolved` / `events-only`.

> This revises `core-extended-split.md:76`: combinator-*over-anchors* ≠ combinator-*over-structures*.
> Only the latter is template-inexpressible.

### The synthetic event is canonical-native

To hold `LATER OF(+12mo, EVENT "ipo")` as a template, the combinator's anchor collapses to a single
atomic event `evt_…`. Then:

- **Spec:** an ordinary `VestingStatement` with `vesting_base:{type:"EVENT", event_id:"evt_…"}`. The
  downstream grid is unchanged.
- **Runtime:** an ordinary `TX_CANONICAL_VESTING_EVENT` witness, once known.

So **the template and the witness need no schema change** — the synthetic event is indistinguishable
from a real named event to canonical, which is correct: by the time canonical sees it, it *is* just an
atomic event. The only thing canonical can't hold is the event's **definition** (`evt_… =
LATER OF(+12mo, EVENT "ipo")`) — see Parts III–IV.

### Not the synthetic-firing smuggle

`core-extended-split.md:174` rejects encoding an independent **absolute-date grid** as an event with a
synthetic firing — faking *service/calendar time* as a condition. Case 2 is different: a combinator
over anchors is a **genuine condition** (its firing date depends on a real event), so representing it
as a named event is legitimate. The distinguishing test: *is the anchor a real condition, or a
calendar date dressed up as one?* Case 2 is the former; the smuggle is the latter (and still routes to
`events-only`).

---

## Part III — The source map and rehydration

### The source map

Externalizing the gate produces a **source map**: `event_id → DSL definition` (a `VestingNodeExpr`
rendered to a DSL string via `@vestlang/stringify`). It rides on extended's output and **absorbs the
blockers** — a blocker stops meaning "I failed to classify" and starts meaning "here is an
externalized condition, its DSL definition, and (currently) why its witness can't be computed yet."

This also surfaces a new output requirement: **extended must expose the canonical `template` +
`runtime` + source map**, not just installments (`packages/types/src/evaluation.ts` is
installments-centric today). Storing the canonical artifact is the whole point of Case 2.

### Worked example (4,800 shares, granted 2025-01-01)

DSL: `100% MONTHLY OVER 48 FROM LATER OF(+12 MONTHS, EVENT "ipo")`.

**Stage A — first evaluation, IPO unfired (as-of 2025-06-01).** `LATER OF(grant+12mo=2026-01-01,
ipo=?)` can't resolve (the max is undetermined). Instead of bailing to `unresolved`, extended
externalizes the anchor:

```jsonc
{
  "fidelity": "template",
  "template": {                                   // canonical SPEC (verbatim OCF semantic fields)
    "id": "resolved",
    "ext": { "vestlang": { "event_definitions": {  // the source map (Part IV)
      "evt_4f9c": "LATER OF(+12 MONTHS, EVENT \"ipo\")"
    } } },
    "statements": [
      { "order": 1, "vesting_base": { "type": "EVENT", "event_id": "evt_4f9c" },
        "occurrences": 48, "period": 1, "period_type": "MONTHS",
        "percentage": { "numerator": 1, "denominator": 1 } }
    ]
  },
  "runtime": { "grantDate": "2025-01-01" },        // RUNTIME — no witness for evt_4f9c yet
  "installments": [],                              // PROJECTION — empty; EVENT statement skipped
  "blockers": [                                    // absorbed into the verdict, advisory
    { "type": "UNRESOLVED_SELECTOR", "selector": "LATER_OF",
      "blockers": [ { "type": "EVENT_NOT_YET_OCCURRED", "event": "ipo" } ] }
  ]
}
```

**Stage B — store.** The canonical template + runtime persist as OCF objects (the `evt_4f9c` EVENT
statement is an ordinary floating-event statement); the source map persists *in* the template's
`ext.vestlang` bag (Part IV). A vestlang-blind reader sees a valid template gated on an opaque,
not-yet-fired event — correct, just opaque.

**Stage C — IPO fires 2027-03-01; rehydrate.** Rehydration is **re-resolution of the anchor
expression**, nothing more:

```
resolve( "LATER OF(+12 MONTHS, EVENT \"ipo\")",
         { grantDate: 2025-01-01, events: { ipo: 2027-03-01 } } )
   = LATER_OF( 2026-01-01, 2027-03-01 ) = 2027-03-01      // IPO arm wins
```

That date **is** `evt_4f9c`'s witness:

```jsonc
{ "eventFirings": [ { "event_id": "evt_4f9c", "date": "2027-03-01" } ] }
```

The **stored template is untouched** — rehydration only *adds a witness*. Canonical's compiler then
runs `compile(template, runtime + witness)` → 48 monthly tranches of 100 from 2027-04-01 to
2031-03-01, telescoping exactly to 4,800.

**Stage D — partial case (monotonic).** Rehydrate at 2026-06-01 (grant+12mo passed, IPO still
unfired): `LATER_OF` still can't resolve (IPO could be later) → no witness produced, blocker narrows
to just `{EVENT_NOT_YET_OCCURRED: "ipo"}`. Rehydration is monotonic — it only ever *adds* witnesses
and *narrows* blockers; re-run it freely across the multi-year pending window.

The point: a synthetic event's witness is **computed by re-resolving the definition**, not attested by
hand. Without the definition the milestone is un-evaluatable except manually — which is the sharp
reason the source map is load-bearing, not decorative.

### The deterministic id — and why not DSL-as-id

The synthetic `event_id` must be (1) **deterministic** — the same anchor expression yields the same id
at emit-time and at every rehydration, because the id is written in three places that must agree
(template statement, source-map key, witness); and (2) **unique per distinct condition** (identical
gates collapse to one id, consistent with the one-firing-per-`event_id` dedup at `lower.ts:213`). The
chosen scheme: a **hash of the canonicalized anchor AST**, namespaced (`evt_…`). Human legibility is
**not** baked into the id — it lives as an optional `label` *in the definition entry* (`{ definition,
label? }`), so a `label` can be edited freely without ever moving identity. (A readable slug-as-id was
rejected: to be safe it needs the same canonicalization plus a hash disambiguator anyway, and a lossy
slug re-imports the natural-key fragility below.)

It is **not** the DSL string itself. Using the DSL as the id is the tempting "self-describing"
shortcut, rejected for three reasons:

1. **Natural-key instability.** The id would be welded to the exact spelling; reordering args,
   relabeling, or a serializer change would change the id and dangle every stored reference/witness. A
   surrogate (hash of the *canonical* form) decouples identity from description — cosmetic edits are
   free, semantic changes correctly yield a new id.
2. **Contract mismatch / honest opacity.** `event_id` is an **OCF-core** field whose contract is
   "opaque identity token." Putting a DSL string there leaks vestlang grammar into core and *lies* to
   core-only consumers: it dangles an evaluable-looking formula at a consumer with no engine and no
   obligation to evaluate it (which may then let a human guess the firing date). An opaque `evt_4f9c`
   tells that consumer the truth — "you can't resolve this; treat it as pending."
3. **Durable-dependency / grammar leak.** `event_id` lives in a durable, multi-party interchange.
   Embedding the grammar there makes the whole coalition's stored data carry a permanent dependency on
   vestlang's grammar versions. The hash keeps the core field grammar-neutral; the grammar lives only
   in the (opt-in) `ext.vestlang` bag.

The mental model: **id = identity (opaque, core, grammar-neutral); definition = meaning (vestlang
grammar, extension).** We keep the self-describing data — just in the field whose contract matches it.

---

## Part IV — Where the definition lives: the `ext` channel

### Placement: template-level, keyed by event_id

The source map lives at the **template level**, `ext.vestlang.event_definitions: { event_id → dsl }`
— **not** on each `VestingBaseEvent`. Because the synthetic id is `hash(definition)`, the definition
is *functionally dependent on* the id: two statements sharing a gate share the id and must share the
definition. Storing it per-reference would be a **denormalization** (duplicate, drift-prone) — which
is precisely the read-model redundancy this project renormalizes away. It also mirrors canonical's own
shape: the **firing** is recorded once per `event_id` (one witness resolves all referencing
statements), so the **definition** — the spec-time twin of the firing — is likewise recorded once per
`event_id`. `VestingBaseEvent` stays byte-for-byte canonical-core.

### What canonical changes

- **No change** to the template/witness **semantic** fields. The synthetic event is native.
- **Add** a two-tier extension channel (Part V): `ext` (ignorable) and `modifierExt`
  (must-understand-or-refuse), as **known named properties** on canonical objects.
- **Keep `additionalProperties: false`.** Unknown *top-level* fields are still rejected — `ext` is the
  one blessed property, and its keys are owned namespaces, so collisions are structurally impossible.
- **Restore `comments`.** Canonical dropped the OCF base-object `comments` array from
  `TX_CANONICAL_VESTING_EVENT` (and the spec objects) with no principled reason; OCF treats `comments`
  as the sanctioned free-text annotation on every object. Bring it back.

### Why this honors OCF's own rationale

OCF forbids extra properties deliberately. Verbatim, from
`docs/explainers/DesignPatterns.md` ("Don't Add Additional Properties to OCF"):

> We do not want the OCF Types and OCF Objects that are meant for use by the community to have
> additional properties. This prevents situations where third-party implementers add custom or
> undocumented fields and types, which could cause:
> - **Unanticipated compatibility issues** when sharing cap tables between systems
> - **Name collisions with future versions of OCF**, if a popular implementation uses a custom
>   property name that we later want to add to the official standard
> - **Loss of interoperability**, which is the core goal of OCF
>
> If you need to store additional metadata, use the `comments` field available on all OCF Objects, or
> maintain a separate mapping table in your system that links OCF object IDs to your custom data.

All three harms are **collision/governance** harms, and a **namespaced** channel eliminates each:
core fields and `ext["namespace"]` content live in disjoint name-spaces, so the "name we later want to
add" can never collide. Note also: the strictness is scoped to *final* objects (primitives already
allow additions for composition), and **OCF already prescribes `comments` or a sidecar mapping table**
keyed by object id — which means our zero-schema-change fallback (a true sidecar keyed by `event_id`)
is *literally OCF's sanctioned pattern today*. The `ext` channel is the **governed, structured
evolution** of that same guidance — not a departure from it.

### Consistent with "no pending field"

The `ext` channel carries the event's **meaning** (spec-time intent), never its **state**. Pending is
still the absence of a witness in core. "No pending field anywhere, by design" remains true — we added
a *meaning* channel, not a *state* channel.

---

## Part V — Designing the extension mechanism for OCF

vestlang is the **first** extension, so this doc implicitly proposes the framework. The reference
model is **HL7 FHIR's extension system** (a durable, multi-party, layered interchange with opt-in
extensions — the closest analog), with lessons from Protocol Buffers, JSON-LD, and the HTTP header
registry.

### What vestlang decides (specify in this design)

- **Two-tier channel: `ext` (must-ignore) vs `modifierExt` (must-understand).** FHIR's keystone: a
  *plain* extension is purely additive — ignoring it still yields a correct core interpretation; a
  *modifier* extension changes meaning, so a consumer that doesn't understand it must **refuse** the
  element rather than silently proceed. **vestlang's event definition is classified plain/ignorable**
  (a core consumer skipping it correctly sees an opaque pending event). The framework must support
  both tiers even though vestlang needs only the plain one — that vestlang needs no modifier extension
  is itself a good sign.
- **Reference core by stable id, never by position.** Extensions point into core via `event_id` (the
  hashed id) — the discipline already embodied by the source-map keying.
- **Lossless passthrough.** A tool that reads → edits → writes OCF MUST preserve extensions it doesn't
  understand (Protobuf's unknown-field rule). Without this, the first extension-blind tool in a
  pipeline silently destroys the data.
- **Layered validation.** Core-conformance must pass with unknown extensions present (hence `ext` as a
  carved-out known property, not relaxed `additionalProperties`); extension-aware validators check the
  payload against the extension's own schema.

### What to raise for the coalition (governance, not vestlang's to decide)

- **Namespace scheme (decided): owned, resolvable identifiers** — canonical URLs (e.g.
  `vesting.vestlang.dev/v1`), not bare strings. FHIR uses canonical URLs precisely to prevent the
  collisions OCF fears and to make unknown extensions discoverable (the URL dereferences to the
  extension's spec). vestlang's near-term **sidecar** may use a short interim `vestlang` key until the
  registry exists. **Open to the coalition:** the **registry** that backs the URL space (cf. the HTTP
  `X-` deprecation, RFC 6648) — governance, not vestlang's to decide.
- **Versioning + self-description.** Each extension payload declares its version so a consumer can
  decide understand / ignore / refuse.
- **Security/trust for *executable* extensions.** vestlang's payload is effectively a small program
  (re-resolved at rehydration). Treat extension payloads as **untrusted input**: sandbox evaluation,
  guard against injection and pathological combinators (resource exhaustion). For financial data this
  is a real trust boundary — and an argument *for* the plain classification (evaluation is opt-in, so
  exposure is opt-in).
- **Governance: no-duplication + graduation.** An extension must not re-encode what core already
  models. Widely-adopted extensions should have a path to **graduate into core** (FHIR migrates common
  extensions into base resources; HTTP graduated `X-` headers).

vestlang serves as the **"happy path" exemplar**: plain, id-keyed, versioned, self-describing,
losslessly preserved, opt-in to evaluate.

---

## Part VI — Carta (downstream export)

None of the above requires Carta; **canonical is the target.** Carta matters only at the export edge,
and its model re-fuses what canonical separates (rule + evaluation status). The one open Carta
question — *which* field a canonical EVENT statement lowers into, `milestoneName` vs.
`performanceCondition` — is an **export-mapping detail**, asked in `carta-vesting-question-email.md`.
The source-map definition *could* surface downstream via `milestoneName`, but that's an export choice,
out of scope here. Canonical's shape (`event_id` + `ext.vestlang` definition) is the same either way.

---

## Implementation approach & cross-repo coordination

- **Ship on the sidecar (the OCF-sanctioned mapping table).** extended emits the source map; the
  shipped, consumer-facing persistence is a **separate mapping keyed by `event_id`** — exactly the
  "separate mapping table that links OCF object IDs to your custom data" the OCF Design Patterns doc
  endorses (interim short `vestlang` key). This is zero-schema-change and fully OCF-conformant *today*,
  so it doesn't block on the coalition. (Trade-off accepted: the canonical artifact alone is opaque,
  and the sidecar must not be dropped — see Part IV's un-evaluatable-milestone caveat.)
- **Propose `ext` as the governed, in-band evolution.** Prototype the two-tier `ext`/`modifierExt`
  channel + restored `comments` in vestlang's *own* canonical (`@vestlang/core` types / local canonical
  JSON) to demonstrate it, then file conforming issues upstream:
  - **OCF-Composed-Schemas** — add the `ext`/`modifierExt` channel (owned-URL keys) to canonical
    objects; restore `comments`; add the event-definition extension; (carry forward the
    time-based-cliff change if not already tracked).
  - **OCF-Tools** — conforming changes (tolerate/preserve `ext`) so the published `@vestlang/core`
    consumer stays aligned. (Demonstrating `ext` in core output is what makes adopting it non-breaking
    there — hence we keep the *shipped* persistence on the sidecar until that lands.)
- The resolver/lowering code change itself (let an EVENT-anchored / collapsible-combinator start build
  into the template; emit `template` + runtime + source map; rehydration entry point) is a later
  `doc-stage` / `doc-implement` pass.

---

## Scope

### Included

- Case 1 (atomic unfired event → `template`; classify on the spec; the HYBRID-bug fix).
- Case 2 (combinator-over-anchors → `template` via synthetic event + source map).
- The source map + rehydration mechanism (rehydration = re-resolution → witness; frozen template).
- The deterministic hashed `event_id` (and the DSL-as-id rejection).
- The `ext` channel proposal on canonical + restored `comments`.
- The OCF extension-mechanism framework (vestlang as charter example).

### Deferred

| Item | Why |
|---|---|
| The resolver/lowering + rehydration **code** | Later `doc-stage`/`doc-implement`. |
| Filing the upstream OCF-Composed-Schemas / OCF-Tools **issues** | After vestlang-local proving. |
| **Partial payouts** | canonical's witness already carries `realized_fraction`; vestlang has no variable-payout concept yet (binary firing is a strict subset). |
| **Modifier-extension** cases | vestlang needs only the plain tier; the framework reserves `modifierExt` for future extensions. |
| Registry / namespace governance | Coalition's to decide (raised in Part V). |
| Market/performance-metric conditions, acceleration, post-termination | canonical already declares these out of scope. |

## Decisions resolved in this review

These four were open going in and are now settled:

1. **Namespace scheme → owned, resolvable URLs** (e.g. `vesting.vestlang.dev/v1`) as the framework
   rule — collision-proof + dereferenceable. vestlang's near-term sidecar may use a short interim
   `vestlang` key. The backing **registry** remains coalition governance (Part V).
2. **Rollout → ship on the sidecar, propose `ext`.** The sidecar (OCF's sanctioned mapping table keyed
   by `event_id`) is what vestlang ships — zero schema change, conformant today. `ext` is the in-band
   evolution we prototype in vestlang-local canonical and propose upstream (Implementation approach).
3. **Id rendering → opaque `evt_<hash>`**, with human legibility carried as an optional `label` in the
   definition entry — never in the id (Part III).
4. **Channel shape → two-tier `ext` / `modifierExt`.** Safety is structural, not a flag; vestlang uses
   only the plain `ext` tier, and `modifierExt` is reserved/specified for future meaning-changing
   extensions (Part V).

### Still open (for the coalition, not this doc)

- The extension **registry / governance** that backs the URL namespace.
- Versioning convention and the **graduation** path from extension into OCF-core (Part V).

## References

- **OCF — Design Patterns explainer** — `docs/explainers/DesignPatterns.md` in
  `Open-Cap-Table-Coalition/Open-Cap-Format-OCF` (the `additionalProperties: false` rationale; verbatim
  passage quoted in Part IV).
  <https://open-cap-table-coalition.github.io/Open-Cap-Format-OCF/explainers/DesignPatterns/>
- **canonical schemas** — `~/code/OCF-Composed-Schemas/canonical/vesting/VestingScheduleTemplate.schema.json`,
  `~/code/OCF-Composed-Schemas/canonical/transactions/vesting/VestingEvent.schema.json` (+ its
  `.mapping.md`); OCF's `objects/transactions/vesting/VestingEvent.schema.json` (the `comments` field).
- **HL7 FHIR extension model** — the reference for plain vs. modifier extensions, canonical-URL
  namespacing, and graduation.
- **Code refs (worktree)** — `packages/evaluator/src/resolve/lower.ts` (`buildTemplate`, `:182`,
  `:213`), `packages/evaluator/src/resolve/classify.ts`, `packages/core/src/compile.ts` (`:166`,
  `:201`), `packages/types/src/evaluation.ts` (the `fidelity` field).
- `docs/core-extended-split.md` — the fidelity ladder; this doc revises its `:76` and `:131`.
- `docs/carta-vesting-question-email.md` — the open Carta export-mapping question.
