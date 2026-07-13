---
title: vestlang — a shared language for vesting
theme: moon
highlightTheme: monokai
css: assets/talk.css
scripts: assets/talk.js
revealOptions:
  transition: fade
  controls: true
  progress: true
  slideNumber: "c/t"
  hash: true
  width: 1280
  height: 720
---

# Vestlang

<p class="byline">Matt Cantor · OCF summit</p>

Note:
- Executive compensation partner at Fenwick & West
- Involved with the project for a few years, on the board, technical working group, law firm working group
- hobbyist coder
- obsessed with vesting

---

## A DSL for writing vesting intent

----

## This is a vesting schedule

<blockquote class="clause">1/4th of the shares shall vest on the one-year anniversary of the Vesting Commencement Date, and an additional 1/48th of the shares shall vest on each monthly anniversary of the Vesting Commencement Date thereafter...</blockquote>

Note:
- This is how lawyers right vesting schedules
- Its verbose, lots of different ways to say the same thing, but familiar enought that we all know what it means
- There is no shared way to *write it down*
- This has annoyed me forever, since I started my career

----

<!-- .slide: data-auto-animate -->

## What if the prose were parsable?

<div class="dsl-grow">VEST OVER 4 years EVERY 1 month</div>

<p class="fragment"><code>OVER -> </code>the total span</p>
<p class="fragment"><code>EVERY -> </code>the release cadence</p> 

----

<!-- .slide: data-auto-animate -->


## Add the cliff

<div class="dsl-grow">VEST OVER 4 years EVERY 1 month CLIFF 1 year</div>

----

<!-- .slide: data-auto-animate -->

<!-- ============================================================
     BEAT 2c — FROM: choosing the start, walked as a four-step
     auto-animate morph. The dsl-grow c-from clause morphs while
     VEST/OVER/EVERY glide to make room; a caption under it names each
     form. Each construction is its own sub-slide so reveal's
     auto-animate runs (it only fires on slide transitions, not on
     in-slide fragments):
       offset   VEST FROM 6 months …         (+6mo DURATION, grant-relative)
       date     VEST FROM DATE 2026-01-01 …  (explicit start)
       event    VEST FROM EVENT IPO …        (base:EVENT — a start with no date yet)
       default  VEST OVER 4 years …          (FROM fades out; the grant date)
     All four verified lint-clean; offset parses to DURATION +6mo,
     event to vesting_start base:EVENT. The event form is the forward
     reference into the "A blank, and a note" beat.
     ============================================================ -->

## Vesting Start

<div class="dsl-grow">VEST FROM 6 months OVER 4 years EVERY 1 month</div>

<p class="dsl-cap">an <strong>offset</strong> from the grant date</p>


----

<!-- .slide: data-auto-animate -->

## Vesting Start

<div class="dsl-grow">VEST FROM DATE 2026-01-01 OVER 4 years EVERY 1 month</div>

<p class="dsl-cap">an <strong>explicit</strong> calendar date</p>

----

<!-- .slide: data-auto-animate -->

## Vesting Start

<div class="dsl-grow">VEST FROM EVENT IPO OVER 4 years EVERY 1 month</div>

<p class="dsl-cap">vesting start contingent on an event</p>


----

<!-- .slide: data-auto-animate -->

## Vesting Start

<div class="dsl-grow">VEST OVER 4 years EVERY 1 month</div>

<p class="dsl-cap"><strong>no <code>FROM</code></strong> — the start is the grant date</p>

----

## Vest just a portion

<div class="dsl-lines">
<div class="dsl-line">0.5 VEST OVER 2 years EVERY 1 month</div>
</div>


----

## One After Another

<div class="dsl-lines">
<div class="dsl-line">0.5 VEST OVER 2 years EVERY 1 month</div>
<div class="dsl-line i1 fragment">THEN 0.5 VEST OVER 2 years EVERY 3 months</div>
</div>

<p class="fragment">the second half begins when the first ends - 4 years in total</p>

Note:
Beat 2, part 4b (~20 sec). THEN runs two portions in sequence: the second half waits
for the first to finish, so the grant stretches to 4 years end to end. The same two
halves appear next with PLUS — watch what changes.

----


## One on top of another


<div class="dsl-lines">
<div class="dsl-line">0.5 VEST OVER 2 years EVERY 1 month</div>
<div class="dsl-line i1 fragment">PLUS 0.5 VEST OVER 2 years EVERY 3 months</div>
</div>

<p class="fragment">both halves run from the same start — 2 years in total</p>

Note:
Beat 2, part 4c (~20 sec). Same two halves, one operator changed. PLUS runs them in
parallel — both start together, so it's done in 2 years, not 4. (In practice PLUS
combines *different* schedules — a monthly tranche beside a quarterly one; identical
halves here just isolate the timing.) Portions must sum to the whole.

----

<!-- ============================================================
     BEAT 2e — the combinators. An anchor can be contingent: LATER OF
     waits for both, EARLIER OF takes the first. This is the bridge into
     the compiler section — the contingency a flat record can't hold.
     Verified: CLIFF LATER OF (12 months, EVENT IPO), IPO 2027-06-01 →
     2,900 lump on 2027-06-01 then 100/mo — a clean template.
     ============================================================ -->

## Selectors

<div class="dsl-lines">
<div class="dsl-line">VEST OVER 4 years EVERY 1 month</div>
<div class="dsl-line i1 fragment">CLIFF LATER OF (12 months, EVENT IPO)</div>
</div>

<p class="fragment"><code>LATER OF -> </code>Waits for both and compares</p>

<p class="fragment"><code>EARLIER OF -> </code>Whichever comes first</p>

Note:
Beat 2, part 5 (~40 sec). The step that makes vestlang more than shorthand. An anchor
doesn't have to be a known date — it can be "the later of a service cliff and a
liquidity event." LATER OF waits for both; EARLIER OF takes whichever lands first.
This is exactly the contingency a lawyer writes in prose and a spreadsheet of dates
cannot hold — and it's the bridge into the rest of the talk: something has to turn
this rule into actual dated numbers. That something is a compiler.

----

<!-- ============================================================
     BEAT 5 — Two-tier → storable OCF template. The proof, grown
     LINE BY LINE: each .dsl-line after the first is a native reveal
     .fragment (authored here, not injected — reveal indexes them at
     init), so the statement gains a line per → and gets taller:
     classic 4-yr monthly → a LATER OF cliff → its second leg is an
     EARLIER OF of two events → each event carries a grantDate + 7
     years deadline (an explicit anchor + duration offset,
     GRANT_DATE + 84mo). Bare 12-month cliff is vesting-start-relative
     (taught on "Add the cliff"). talk.js recolors each line in place;
     no <code>, so reveal's highlight plugin leaves the spans alone.
     Nesting is driven by the i1/i2/i3 padding classes, not literal
     leading spaces — reveal's markdown mangles deeply-indented lines
     (turns the spaces into a blank line), so the indent lives in CSS.
     Verified: stores as a template; world picks the projection.
     ============================================================ -->

## Two-Tier Vesting

<div class="dsl-lines">
<div class="dsl-line">VEST OVER 4 years EVERY 1 month</div>
<div class="dsl-line i1 fragment">CLIFF LATER OF (</div>
<div class="dsl-line i2 fragment">12 months,</div>
<div class="dsl-line i2 fragment">EARLIER OF (</div>
<div class="dsl-line i3 fragment">EVENT IPO BEFORE grantDate + 7 years,</div>
<div class="dsl-line i3 fragment">EVENT CIC BEFORE grantDate + 7 years))</div>
</div>

Note:
Beat 5 (~2 min). The proof, on the single most common real contingency — build it
line by line (→ reveals each): (1) the classic 4-year monthly; (2) a cliff, but a
LATER OF — nothing releases until BOTH a time gate AND something else; (3) that
something is an EARLIER OF of two liquidity events; (4) each event carries a
deadline — `grantDate + 7 years` is an anchor plus a duration offset (the grant's
7th anniversary), the fuse that forfeits the grant if no liquidity lands in time.
Read as intent: "vest monthly over 4 years, nothing releases until both the 1-year
service cliff and a liquidity event — whichever is later — and that event must land
within 7 years or the grant is forfeited." Engine (verified): stored ahead of any
firing it's a clean OCF *template* — a 12-month cliff baseline plus an event-condition
holding the liquidity gate. Then the same spec resolves differently by when the event
lands: late → a ~2,900 lump on the event date then monthly; early → the 12-month cliff
wins and you get 1,200-then-100/mo, exactly beat 2's schedule re-emerging. That IS
spec → compiler → projection: the DSL holds the contingency a flat record can't; the
compiler resolves it to something storable; runtime picks the projection.

---

<!-- ============================================================
     BEAT 3 — The standards moment. Zoom out from the personal
     story to the ecosystem. Present tense: OCF Core is in-flight.
     ============================================================ -->

## A reference compiler for an OCF vesting spec

Note:
Beat 3 (~1 min). The hinge out of the personal story into the ecosystem. Keep it
present tense and honest: OCF Core is being drafted, this summit is introducing
it, and the piece that matters for me is that it carries a NEW vesting spec meant
to replace the old DAG-based vesting model. This is why I'm telling *this* room:
there's a live standards effort, and vesting is squarely inside it.

----

<!-- ============================================================
     BEAT 4 — The insight. Vesting = spec + compiler + projection.
     Named, not proved (beat 2 already showed it). Ends on the
     bridge line: vestlang = a reference compiler.
     ============================================================ -->

## Vesting isn't a shape

Most parts of a cap table are stored and read back.<!-- .element: class="fragment" -->

The vesting schedule is different.<!-- .element: class="fragment" -->

The cap table stores the vesting spec, and the vesting events that come out of it.<!-- .element: class="fragment" -->

A compiler is needed to turn the vesting spec into the vesting events.<!-- .element: class="fragment" -->

Note:
Beat 4 (~1 min). The intellectual core — but don't PROVE it here, beat 2 already
did. Just name what they saw: one line became exact numbers, and *something* had
to turn the rule into those numbers — that's a compiler. The rest of the cap
table is shapes you store and read back; vesting is spec + compiler + projection.
OCF standardized only the projection; its one spec-layer attempt (the DAG) never
got adopted. Land the closing line hard — it's the bridge into the proof (beat 5):
vestlang is a first reference compiler for the spec OCF Core is drafting.

---

## A classifier for what OCF can hold
----

## Two modes

<div class="two-col classify">
<div class="col">

### storable
*blind to events · immune to back-dated firings*

- **template** — expressed as OCF vesting spec
- **events-only** — only vesting events, no spec
- **unrepresentable** — no home in OCF at all
- **impossible** — self-contradictory

</div>
<div class="col">

### resolution
*honors known events · intent lost, facts kept*

- **template** — expressed as OCF vesting spec
- **events-only** — only vesting events, no spec
- **unresolved** — still waiting on an event
- **impossible** — self-contradictory

</div>
</div>

> The two can **disagree**.
> The difference is the **seam** that articulates what OCF can and cannot express

----

<!-- ============================================================
     The classifier in action — a 2×2. Same cliff, one selector.
     LATER OF (12 months, EVENT B): storable (a held cliff → an OCF
     spec). EARLIER OF (12 months, EVENT B): unrepresentable (an event
     can pull the cliff below the 12-month ceiling, so it can't be
     pinned) — yet it still RESOLVES (falls back to 12 months). Left
     cells showcase what each mode produces. Verified on the engine
     (grant 2025-01-01, 4,800 sh). (#528 makes the *pure two-event*
     EARLIER OF storable, but NOT this time+event case — stable.)
     ============================================================ -->

## The classifier in action

<div class="two-col">
<div class="col">

**OCF can hold it**

- storable → **an OCF spec**
- resolution → the later of 12 months and B

</div>
<div class="col">

```vest
VEST CLIFF
    LATER OF (12 months, EVENT B)
```

</div>
</div>

<div class="two-col">
<div class="col">

<span class="seam">OCF can't hold it</span>

- storable → **nothing to store**
- resolution → the earlier of 12 months and B

</div>
<div class="col">

```vest
VEST CLIFF
    EARLIER OF (12 months, EVENT B)
```

</div>
</div>

> In this example `LATER OF` vs `EARLIER OF` is the seam between storable OCF and the vestlang extension.

----

<!-- ============================================================
     A placeholder, and a note — how a contingent START gets stored.
     NOT a blank: canonical's start is always a DATE, so vestlang stores
     a real, valid, far-future date — the sentinel 9999-12-31 — that a
     blind reader accepts but that never vests (fail-visible), plus an
     out-of-band note (the synthetic-event recipe evt:start). Rehydrate
     swaps the placeholder for the real date when the event fires.
     Verified (persist VEST FROM EVENT ipo, grant 2026-01-01):
     startDate = 9999-12-31, sidecar evt:start = "EVENT ipo";
     rehydrate ipo@2026-03-01 → start_to_apply = 2026-03-01.
     Laid out as a 2×2 (canonical | note) × (stored | fired), matching
     the classifier-in-action grid.
     ============================================================ -->

## Example 1: Contingent Vesting Start

<!-- .slide: class="storage-ex" -->

*"Vesting starts when the IPO happens"* 

<div class="two-col">
<div class="col">

Storable

- `vesting start = 9999-12-31`

</div>
<div class="col">

Vestlang sidecar
- <span class="seam"><code>`evt:start → EVENT IPO`</code></span>

</div>
</div>

<div class="two-col">
<div class="col">

Update record-keeper
- `vesting start = 2026-03-01`

</div>
<div class="col">

The sidecar resolves
- `IPO = 2026-03-01`

</div>
</div>

> The contingency lives in the **vestlang sidecar** — the record-keeper never has to understand it. When the event fires, the user just swaps the placeholder for the real date, exactly as they would today.

Note: `vesting start = 9999-12-31` the record needs a **date**, and there's none yet. Canonical's start is *always* a date, so vestlang stores a **far-future placeholder** that never vests, with the true start in a **note**:
----

<!-- ============================================================
     Example 2 — a GATED EVENT in the CLIFF, lowered into a synthetic
     event. Same trick as Example 1, one level down: canonical can hold
     a plain event_condition pointer, but NOT the contingency riding on
     it (the IPO gated on firing before grant + 7 years). So the gated
     event becomes a stand-in `evt:1` whose recipe lives in the note;
     there's no time baseline, so no `cliff` field at all — the whole
     cliff IS the event.
     Verified (persist VEST OVER 4 years EVERY 1 month
       CLIFF EVENT ipo BEFORE grantDate + 7 years, grant 2026-01-01):
       no cliff, event_condition evt:1,
       sidecar evt:1 = "EVENT ipo BEFORE EVENT grantDate +84 months".
     Rehydrate ipo@2027-06-01 (in window) → firings_to_apply
       evt:1 = 2027-06-01; ipo@2034 (out of window) → dead, empty
       projection. Same 2×2 as Example 1.
     ============================================================ -->

## Example 2: Contingencies

<!-- .slide: class="storage-ex" -->

<div class="dsl-lines">
<div class="dsl-line">VEST OVER 4 years EVERY 1 month</div>
<div class="dsl-line i1">CLIFF EVENT A BEFORE EVENT B</div>
</div>

<div class="two-col">
<div class="col">

Storable
- `event_condition → evt:1`

</div>
<div class="col">

Vestlang sidecar
- <span class="seam"><code>`evt:1 → EVENT A BEFORE EVENT B`</code></span>

</div>
</div>

<div class="two-col">
<div class="col">

Update record-keeper
- `evt:1 = 2027-06-01`

</div>
<div class="col">

The sidecar resolves
- `EVENT A = 2027-06-01`

</div>
</div>

> Same mechanism as the contingent start. The record-keeper holds a plain event pointer and does not have to understand the contingency. The contingency lives in the **vestlang sidecar**.

---

<!-- ============================================================
     SECTION — the inferrer: reading the cap tables that already
     exist back into OCF. Beats 6–7 are verticals under this header.
     ============================================================ -->

## An on-ramp for existing cap tables

----

<!-- ============================================================
     The inferrer — beats 6+7 collapsed into one slide, animations
     dropped. A real cap table is just {date, amount}; the inferrer
     proposes candidate specs, runs each FORWARD through the same
     reference compiler, and keeps the one that reproduces the numbers
     to the share = the migration on-ramp. Verified: beat-2 tranches
     (1,200 then 100/mo) → VEST OVER 48 months EVERY 1 month CLIFF 12
     months, residual error 0.
     ============================================================ -->

## From numbers back to a spec

<div class="two-col">
<div class="col">

**what you have**

```text
2026-01-01   1,200
2026-02-01     100
2026-03-01     100
    ⋮            ⋮
```

</div>
<div class="col">

**what comes back**

```vest
VEST OVER 48 months
  EVERY 1 month
  CLIFF 12 months
```

</div>
</div>

No guessing: it proposes candidate specs, runs each **forward through the same compiler**, and keeps the one that reproduces your numbers **to the share.**

> The reference compiler, used to *search*. A **verified** way into OCF for cap tables that already exist,
and a way to validate that a spec and its projection agree

Note:
The inferrer (~2 min), reworked to one slide, no animation. Real cap tables aren't
DSL — they're columns of {date, amount}. The inferrer recovers the spec, but it's
no heuristic fit: it proposes candidates (a train, a cliff, a pre-grant fold, a THEN
chain) and runs each FORWARD through the very same compiler the talk has used,
keeping only the one that reproduces the input to the share (our run: residual error
zero). So it's the reference compiler used to SEARCH — provably faithful, and tied
back to the thesis rather than a separate magic trick. The payoff is migration: the
biggest wall to any standard is that everyone already has data in a proprietary
shape; this reads that data into canonical / OCF form. Honest scope line if asked:
it recovers the structure of what HAPPENED, not contingency that already resolved
into the numbers — feed it the double-trigger's resolved output and you get a plain
cliff back.

----

<!-- ============================================================
     Inferrer slide 2 — coverage + graceful degradation. Left: the
     shapes it recognizes as concise specs (each a candidate that must
     round-trip through the compiler before it's offered). Right: the
     literal per-date fallback for anything else — it never fails, it
     bails to an imperative PLUS-chain of dated lumps.
     Verified on the engine: clean cliff stream → a concise CLIFF spec
     (residualError 0, fallback false); irregular 4-tranche stream →
     500 VEST FROM DATE … PLUS … (residualError 0, fallback true, note
     "no template shape verified; emitted the literal per-date fallback").
     Families/order from the infer tool: plain < cliff < pre-grant fold
     < THEN chain < single lump < literal. The bounded PLUS-cover pass
     (concurrent superpositions) is deliberately left off — it's narrow,
     undocumented in the tool, and a plausible superposition dropped to
     the literal fallback in testing, so it's not a claim worth demoing.
     The ~2,000 figure is the round-trip oracle
     (packages/inferrer/tests/roundtripOracle.test.ts:553-582): ~2,010
     generated inferences, every case projMatch=true, the structural-
     failure set asserted empty. That is PROJECTION reproduction (numbers
     to the share), NOT recovery of the original authoring intent —
     fam1/fam2 ambiguity is expected and out of scope for this slide.
     ============================================================ -->

## Will it work on my cap table?

<div class="two-col">
<div class="col">

**Shapes it recognizes**
- a uniform **train**
- a **cliff**
- a **pre-grant fold** — vesting before the grant
- a **`THEN` chain** of segments

*each candidate round-trips through the compiler before it's offered*

</div>
<div class="col">

**When nothing fits**

```vest
500 VEST FROM DATE 2026-03-15
PLUS 1200 VEST FROM DATE 2026-09-02
PLUS 300 VEST FROM DATE 2027-01-20
⋮
```

*it never fails — worst case a literal, per-date list: imperative and ugly, but lossless and exact*

</div>
</div>

> Across **~2,000** generated schedules, every one reproduces **to the share** — concise where there's structure, an honest event-by-event list where there isn't.

---

<!-- ============================================================
     BEAT 8 — The invitation. Insider bringing a contribution;
     no hard ask, no manufactured question.
     ============================================================ -->

<p class="subtitle">github.com/MattCantor/vestlang · mattcantor.github.io/vestlang</p>

Note:
Beat 8 (~45 sec). The bookend. Because I opened as a practitioner AND a member of
this working group, this isn't a vendor pitch — it's an insider bringing a
contribution home. No hard adoption ask, no manufactured question. Just: here's a
working reference compiler for the spec you're drafting, plus a tool to get
existing data in, it's open source, and I'd love for us to build on it together.
Then open the floor.
