---
title: vestlang — a shared language for vesting
theme: moon
highlightTheme: monokai
css: /assets/talk.css
scripts: /assets/talk.js
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

<!-- ============================================================
     BEAT 2a — the skeleton, and the start of the auto-animate morph
     chain (skeleton → +CLIFF → +FROM). Each clause is its own data-id
     span (via talk.js dsl-grow), so shared clauses glide while the new
     one fades in. Verified (grant 2025-01-01, 4,800 sh): 48 slices of
     100, first 2025-02-01, last 2029-01-01 — clean template, no cliff.
     ============================================================ -->

## What if the prose were parsable?

<div class="dsl-grow">VEST OVER 4 years EVERY 1 month</div>

<p class="fragment"><code>OVER -> </code>the total span</p>
<p class="fragment"><code>EVERY -> </code>the release cadence</p> 

Note:
Beat 2, part 1 (~40 sec). Don't show the whole line — build it. Start with the
shape: two words. OVER is the span, EVERY is the cadence. Both halves matter: a
lawyer reads this sentence; a computer gets integer-exact allocation with no
drift. Today you get prose OR a spreadsheet, never both in a form that moves
between systems. The next two slides finish the schedule from the opening clause.

----

<!-- .slide: data-auto-animate -->

<!-- ============================================================
     BEAT 2b — the cliff. Morph step 2: CLIFF 1 year appends to the
     running line (a trailing grow). Ties back to the cold-open clause:
     the 12-month cliff produces the "1/4" (12 of 48 months release at
     once), then a 48th monthly. Verified: 1,200 on 2026-01-01, then
     100/mo × 36 → 4,800 by 2029-01-01.
     ============================================================ -->

## Add the cliff

<div class="dsl-grow">VEST OVER 4 years EVERY 1 month CLIFF 1 year</div>

Note:
Beat 2, part 2 (~40 sec). Add one word and the whole opening clause falls out. The
cliff isn't a negotiated 25% — it's a *gate*: nothing releases for a year, then the
first twelve months land together (12/48 = a quarter), and monthly after. Reframing
the cliff as a gate plants the idea the rest of the talk leans on. Close the loop:
read this line back as the offer-letter sentence — same schedule, now exact.

----

<!-- .slide: data-auto-animate -->

<!-- ============================================================
     BEAT 2c — FROM: choosing the start. Morph step 3: FROM inserts
     between VEST and OVER (OVER/EVERY glide right, FROM fades in). The
     cliff is dropped here — the FROM line stays short and the cliff
     isn't needed to show the start — so the 3→4 morph also fades CLIFF
     out. FROM 6 months parses to a bare +6mo DURATION (AST sign PLUS),
     i.e. an offset from the grant date, resolved at runtime. The event
     form (FROM EVENT ipo → vesting_start base:EVENT, lint-clean) is a
     start with no date yet — kept here as an explicit forward-reference
     to the "A blank, and a note" beat, since it's real DSL today.
     Verified lint-clean: VEST FROM DATE 2026-01-01 OVER 4 years EVERY
     1 month.
     ============================================================ -->

## Vesting Start

<div class="dsl-grow">VEST FROM DATE 6 months OVER 4 years EVERY 1 month</div>

<p class="fragment"><code>FROM &amp;lt;duration&amp;gt; -> </code>offset from grant date</p>

<p class="fragment"><code>FROM DATE &amp;lt;iso date&amp;gt; -> </code>explicit vesting start</p>

<p class="fragment"><code>FROM EVENT &amp;lt;event name&amp;gt; -> </code>event-based vesting start</p>

<p class="fragment"><code>no FROM keyword -> </code>vesting starts from grant date</p>

Note:
Beat 2, part 3 (~30 sec). Where does the clock start? By default, the grant date.
FROM moves it: a fixed calendar date, or an offset ("six months after grant"). Tease
the third option — the start can also wait on an *event* — and say "hold that," it's
where this gets interesting.

----

<!-- ============================================================
     BEAT 2d.1 — the portion prefix. A leading fraction gives a
     statement part of the grant; a lone 0.5 is valid but warns
     (portion-allocation: 50% allocated), which motivates combining.
     ============================================================ -->

## Vest just a portion

```vest
0.5 VEST OVER 2 years EVERY 1 month
```

- a leading `0.5` gives this statement **half** the grant
- the rest stays unallocated — so you combine it with more

Note:
Beat 2, part 4a (~20 sec). Any statement can take a leading fraction — a portion of
the grant. On its own, 0.5 leaves half unallocated (vestlang warns you), which is the
setup: to use the whole grant, combine portions. Two ways to combine, next.

----

<!-- ============================================================
     BEAT 2d.2a — THEN (sequential). Same two halves as the PLUS
     slide; only the operator differs. Verified (grant 2025-01-01,
     4,800): 100/mo 2025-02-01 … 2029-01-01 — 4 yrs end to end; the
     2nd half starts 2027-02 after the 1st finishes 2027-01. Lint clean.
     ============================================================ -->

## Combine portions

### one after another — `THEN`

```vest
0.5 VEST OVER 2 years EVERY 1 month
  THEN 0.5 VEST OVER 2 years EVERY 1 month
```

the second half starts when the first finishes — **4 years** end to end

Note:
Beat 2, part 4b (~20 sec). THEN runs two portions in sequence: the second half waits
for the first to finish, so the grant stretches to 4 years end to end. The same two
halves appear next with PLUS — watch what changes.

----

<!-- ============================================================
     BEAT 2d.2b — PLUS (parallel). Same two halves as the THEN slide.
     Verified (grant 2025-01-01, 4,800): 200/mo 2025-02-01 … 2027-01-01
     — both halves over the same 2 yrs. (Identical halves are artificial
     — they isolate timing; real PLUS combines different schedules.)
     Portions must sum to the whole. Lint clean.
     ============================================================ -->

## Combine portions

### one on top of another — `PLUS`

```vest
0.5 VEST OVER 2 years EVERY 1 month
  PLUS 0.5 VEST OVER 2 years EVERY 1 month
```

both halves run from the same start — done in **2 years**

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

```vest
VEST OVER 4 years EVERY 1 month
  CLIFF LATER OF (12 months, EVENT IPO)
```

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
     BEAT 5 — Two-tier → storable OCF template. The proof, revealed
     LINE BY LINE (pre.dsl-lines → each line after the first is a
     reveal fragment): classic 4-yr monthly → a LATER OF cliff → its
     second leg is an EARLIER OF of two events → each event carries a
     grantDate + 7 years deadline (an explicit anchor + duration
     offset, GRANT_DATE + 84mo). Bare 12-month cliff is vesting-start-
     relative (taught on "Add the cliff"). Verified: stores as a
     template; world picks the projection.
     ============================================================ -->

## Two-Tier Vesting

<pre class="dsl-lines"><code>VEST OVER 4 years EVERY 1 month
  CLIFF LATER OF (12 months,
                  EARLIER OF (EVENT IPO BEFORE grantDate + 7 years,
                              EVENT CIC BEFORE grantDate + 7 years))</code></pre>

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

- **template** — expressed as OCF vestig spec
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

> One selector — `LATER OF` vs `EARLIER OF` — is the seam.

----

<!-- ============================================================
     A blank, and a note — how a contingency gets stored, told plainly.
     A contingent start can't be a date, so vestlang stores a fail-visible
     placeholder (the sentinel 9999-12-31) plus an out-of-band note (the
     synthetic-event recipe evt:start), and fills the blank when the event
     fires (rehydrate → start_to_apply). Verified: persist
     `VEST FROM EVENT ipo` → sentinel + evt:start = "EVENT ipo";
     rehydrate ipo@2026-03-01 → start_to_apply = 2026-03-01.
     ============================================================ -->

## Example 1: Contingent Vesting Start

*"Vesting starts when the IPO happens"* — but the record needs a **date**, and there isn't one yet.

So vestlang stores a **blank** where the date goes, and a **note** beside it:

<div class="two-col">
<div class="col">

**Stored today** — plain, blind
- `vesting start = ▢`  *(a blank)*
- note → *start = IPO*

</div>
<div class="col">

**When the IPO fires** — Mar 2026
- `vesting start = 2026-03-01`
- → the schedule follows

</div>
</div>

> The contingency lived in the **note**. The record-keeper never had to understand it.

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

A real cap table isn't a spec — it's a **column of dates and amounts.**

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

> The reference compiler, used to *search* — a **verified** way into OCF for the cap tables that already exist.

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

---

<!-- ============================================================
     BEAT 8 — The invitation. Insider bringing a contribution;
     no hard ask, no manufactured question.
     ============================================================ -->

## Let's build on it

- **Flip the dependency**. Build out the **reference compiler** for the OCF vesting spec and bring it an OCF repo

<p class="subtitle">github.com/MattCantor/vestlang · mattcantor.github.io/vestlang</p>

Note:
Beat 8 (~45 sec). The bookend. Because I opened as a practitioner AND a member of
this working group, this isn't a vendor pitch — it's an insider bringing a
contribution home. No hard adoption ask, no manufactured question. Just: here's a
working reference compiler for the spec you're drafting, plus a tool to get
existing data in, it's open source, and I'd love for us to build on it together.
Then open the floor.
