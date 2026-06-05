---
title: Vesting Schedules as Radio Astronomy
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

# Vesting Schedules<br/>as Radio Astronomy

<p class="subtitle">the deconvolution algorithm that images the sky,<br/>pointed at a cap table</p>

<p class="byline">Matt Cantor · OCTC Summit</p>

Note:
SUBTITLE IS STILL TBD — alternates in the arc doc. Safe-for-program-listing
hedge is "Deconvolving the Cliff."

Open low-key. The title is deliberately over-the-top; don't explain it yet. It
gets earned in Act III (Beat 8). Promise nothing — just start with a cliff.

Whole-talk discipline: never let "express" mean outputs and descriptions in the
same breath. Outputs = "the same SCHEDULES." Descriptions = "the same WAYS OF
WRITING it." Same on the first, different on the second.

---

<!-- ===================== ACT I — what is a cliff? ===================== -->

## Here's a cliff

<div class="vl-anim" id="curve-cliff" data-anim="cumulative-curve" data-caption="4-yr monthly, 1-yr cliff — cumulative">[ cumulative vesting curve ]</div>

Four-year vest. One-year cliff.

Note:
Beat 1 (~1.5 min). On screen: a single cumulative-vesting curve — flat stretch,
the step up at month 12, then the monthly staircase.

Say: Everyone here knows this shape. A lawyer pictures it, an engineer pictures
it, a founder pictures it — and you all picture the SAME thing. That agreement is
rare. Hold onto it, because it's about to break.

---

## Where did 25% come from?

<div class="vl-anim" id="curve-25" data-anim="cumulative-curve-annotate" data-caption="annotate the step: 25% = 12/48">[ same curve · highlight the month-12 step · 25% = 12/48 ]</div>

A cliff is a **gate**, not an amount.

Note:
Beat 2 (~2 min). Highlight the step at month 12; annotate 25% = 12/48.

Say: The cliff releases 25% at the one-year mark. Where did 25% come from? Nobody
chose it. It's just 12 months out of 48. Vesting was accruing the whole time —
the cliff didn't ADD anything, it WITHHELD and then released exactly what had
already accrued. So a cliff isn't an amount. It's a gate. The number on the step
is a CONSEQUENCE of the schedule, not an input to it.

This is the first reframe — the "lie" in the old title. The familiar thing is not
what they thought it was.

---

## You've seen this one too

<div class="vl-anim" id="curve-fork" data-anim="two-curves" data-caption="25% derived vs 30% asserted — same shape">[ two curves, same flat→step→staircase shape ]</div>

"**30%** at one year, then the rest monthly."

Note:
Beat 3 — the fork (~1.5 min). Two curves, same shape class (flat → step →
staircase). Label them only after the question.

Say: Here's a schedule you've also all seen: 30% at one year, then the rest
monthly. Same shape on the chart. But this 30% did NOT fall out of anything.
Someone negotiated it and typed it down.

The number is deliberately ≠ 25%. A derived cliff can only land on a clean count
fraction — 25% = 12/48. THIRTY percent would need 14.4 months into a 48-month
grid. It can't fall out. It MUST be asserted.

So we have two cliffs that look identical and are secretly opposites: one
DERIVED, one ASSERTED. That tiny distinction — did the number fall out, or did
someone type it — is a fork in the road. The rest of the talk walks down it.

---

## A schedule is a signal

<div class="vl-anim" id="anim-a1" data-anim="A1" data-caption="A1 — pulse, train, and stacking → sum">[ A1: bars on a date line; component rows beneath sum to the top row ]</div>

a **pulse** · a **train** · stacked, they **add**

Note:
Beat 4 — THE LENS (~3 min). This used to be a 1-minute aside. It is now the hinge
of the whole talk. Animation A1 builds the vocabulary: shares landing on dates =
a little signal; a PULSE is one lump on one date (exactly a cliff); a TRAIN is a
regular run of equal pulses (exactly ordinary monthly vesting). Stack them — where
they land together, shares add. Schedule = sum of component signals.

Completeness, spoken: you could build ANY schedule by dropping one pulse per date,
so there's nothing you can't express. Trains aren't there to say MORE — they're so
you don't spell out 48 pulses by hand. A four-year vest is one train, not 48
pulses.

The promotion move (the ~20-sec line that makes the talk fuse): notice what we
just did — we didn't pick a REPRESENTATION, we picked a WAY OF LOOKING. We can now
point this lens at any schedule at all. Hold that thought; we'll point it
backwards at the end.

----

### One train, not forty-eight pulses

<div class="vl-anim" id="anim-a1-train" data-anim="A1-train" data-caption="48 pulses collapse into one train">[ 48 separate pulses → collapse into a single labeled train ]</div>

Note:
Optional vertical sub-slide if the room wants the completeness point made
visually: show 48 individual pulses collapsing into one "train" token. The
fancier building block is compression, not extra power.

---

<!-- ===================== ACT II — two honest ways ===================== -->

## Build the cliff — don't type it

<div class="vl-anim" id="anim-a2" data-anim="A2" data-caption="A2 (forward) — train + 12-mo cliff gate → 25% emerges">[ A2: a 48-mo train, gated at month 12; the 25% step appears — nothing typed ]</div>

```text
VEST OVER 48 months EVERY 1 month CLIFF 12 months
```

Note:
Beat 5 — the derived path pays off (~3 min). Animation A2, FORWARD. Build the
DERIVED 25% cliff — the Beat-1 curve itself — by stacking: a 48-month monthly
train, gated by a 12-month cliff. The first 12 installments are withheld and
released as one lump. The 25% step EMERGES from 12/48. You never type a
percentage. THIS is "a cliff is a consequence, not an input."

Contrast (sharpens the fork): the 30% asserted cliff CAN'T be built this way — no
clean count gives 30% over 48 months — so you must state the amount. Both models
can express it; neither makes it fall out.

DSL note: this is the first real vestlang on screen — keep it as a glimpse, not a
lesson. Lint-verified (vestlang_lint, empty diagnostics) and math-verified
(vestlang_evaluate): on a 4800-share grant, month 12 = 1200 = exactly 25% = 12/48,
then 100/mo x 36. The inferrer recovers the SAME schedule from the Beat-1 tranches
(cliffFolds:1, residualError:0) but prints it in absolute form: "4800 VEST FROM
DATE 2025-01-01 OVER 48 months EVERY 1 month CLIFF 12 months". For the Beat 9
callback, show this relative form and say the inferrer's output is equivalent —
don't claim the two strings are byte-identical (they're not).

----

### The asserted one, for contrast

```text
[.3 VEST CLIFF 12 months,
 .7 VEST FROM 12 months OVER 36 months EVERY 1 month]
```

The **30%** has to be **stated**. Same schedule, different road.

Note:
Guardrail sub-slide. The "just write the number" approach lands on the very same
schedule — it just gets there by stating the amount. Same destination. The point
is not that one is wrong; it's that only the derived cliff makes the number FALL
OUT. Lint-verified: the bracket-list form is the valid multi-statement syntax
(two bare statements on separate lines is a SYNTAX ERROR in vestlang — programs
with >1 statement must use [stmt, stmt]). On a 10000-share grant this evaluates to
3000 (=30%) at month 12 plus ~194/mo.

---

## The catch: where does each piece start?

<div class="vl-anim" id="anim-a2-start" data-anim="A2-start" data-caption="a question mark over the start of the second piece">[ the two pieces from A2, with "where does this begin?" over piece two ]</div>

One thread pulled — **three others move.**

Note:
Beat 6 (~2 min). Composing pieces forces a question the single curve never had to
answer: where does each piece start? Does the second piece pick up exactly where
the first left off, or float on its own?

Say: I went in trying to clean up CLIFFS, and somewhere along the way I'm now
making decisions about where vesting BEGINS. One innocent question — what's a
cliff? — quietly dragged a second one into the room. That's a design space
unfolding: you pull one thread and three others move.

---

## Two honest ways to write the same signal

<div class="two-col">
<div class="col">

### Hoist the start,<br/>vest sequentially
*one start · in order · cliffs may name their amount*

- Author can barely make a mistake — **safe by construction**
- Expresses anything by writing the amount down
- Push it far enough → a spreadsheet. **No real language left**
- Easy to read & trust — *because* it's rigid

</div>
<div class="col">

### Free the start,<br/>compose proportional pieces
*no privileged start · pieces anchor & sum · cliffs emerge*

- Amounts stay **derived from structure** — **it's a language**
- Every schedule = a **sum of component signals**
- Same power lets you build what you didn't mean — **care is on the author**
- One schedule, many spellings — harder to compare without running it

</div>
</div>

> Not power vs. safety — both are powerful. It's **safety-by-construction vs.
> being-a-language**. You pay for elegance in **trust**.

Note:
Beat 7 — the centerpiece (~3 min). The key reframe the spine buys us: BOTH columns
are notations over the SAME signal. The signal is the neutral ground the
comparison stands on.

Say: Neither column is wrong. One is hard to break and easy to read, and at its
limit stops being a language at all. The other is a real language with one clean
idea, and it hands you a tool sharp enough to cut yourself. Same schedules out the
bottom. Different costs.

Monotonicity / clawback flourish (10 sec, pre-empts the clawback Q): every
building block only ADDS shares, so a schedule only climbs — correct, because
vesting only goes one way. A clawback isn't part of the schedule; it's an
AMENDMENT acting on its output. Keeping them apart is the honest model.

---

<!-- ===================== ACT III — read it backwards ===================== -->

## Real life hands you the numbers

<div class="vl-anim" id="rows" data-anim="tranche-rows" data-caption="a column of {date, amount} rows">[ a plain table of {date, amount} rows — no rule, no DSL ]</div>

Everything so far: **DSL → schedule.**
Now: **schedule → ?**

Note:
Beat 8 — the inverse question (~1.5 min). Real life never hands you the DSL. It
hands you a cap table: a list of {date, amount} rows, and asks "what IS this —
what's the rule?" If a schedule is a signal, reading its structure back out of raw
numbers is just DECOMPOSITION. The forward lens has an inverse, and we already
have the vocabulary for it.

Plant the seed Act III pays off: going backward isn't guaranteed unique. The same
numbers might have come from different intentions. Hold that — we'll hit it.

DO NOT say "now let's infer." Set up the reveal on the next slide.

---

## I want to show you something

<div class="vl-anim" id="anim-a3" data-anim="A3" data-caption="A3 — matching pursuit = CLEAN: peak → subtract → recurse">[ A3: raw bars → lift the dominant train → residual → fold the lump into a cliff → DSL ]</div>

This is how a radio telescope turns a blur into a galaxy.
It's also how we read a cap table. **Same algorithm.**

Note:
Beat 9 — the centerpiece of Act III + the title payoff (~2.5 min). Animation A3 is
A1/A2 run BACKWARD. Use the SAME 25% schedule — the Beat-1 curve — now as raw
numbers. Close the loop.

Run the animation FIRST, silently, then land the line: "This is how a radio
telescope turns a smeared blur into a picture of a galaxy. It's also how we're
about to turn a column of numbers back into a vesting schedule. Same algorithm."

The isomorphism is real, not a vibe: the inferrer is MATCHING PURSUIT; radio
interferometry's CLEAN (Högbom, 1974) is the same greedy deconvolution — find the
brightest component in the residual, subtract a scaled copy of the instrument
response, recurse on what's left, accumulate the pieces.

Steps to animate (each = one turn of CLEAN's loop):
1. Raw bars (the signal) — no labels, just dates & heights.
2. Find the dominant regular component → a 48-mo TRAIN lifts out. Subtract.
3. What's left is one lump at month 12 → folds back into the 12-mo CLIFF.
4. Residual zero (verified: residualError:0, cliffFolds:1). Out drops the DSL —
   the same schedule as Beat 5 (the inferrer prints it absolute:
   "4800 VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month CLIFF 12 months").

This is "with just the numbers, here's the structure you can pull out." Beat 10
shows that structure has a ceiling — and how context raises it.

Accuracy guardrail: keep "Fourier / frequency domain" as a SPOKEN metaphor only —
nothing here runs a transform. The greedy peak → subtract → recurse loop the
animation shows is literally matching pursuit / CLEAN, so the spectroscopy language
holds for that step. Just don't sell it as the whole method: the inferrer uses that
greedy pass only to seed a branch-and-bound search for the minimum-component cover.
Seed is literally CLEAN; the optimizer is branch-and-bound.

----

### And it falls out as the language

```text
VEST OVER 48 months EVERY 1 month CLIFF 12 months
```

The decomposition's output *is* vestlang.

Note:
The schedule the inferrer recovers is the same one the room saw in Beat 5 — the
language reappears not as something taught, but as the thing the decomposition
PRODUCES. Round-trip verified (residualError:0). Show the clean relative form
here; the inferrer's literal output is the equivalent absolute form ("4800 VEST
FROM DATE 2025-01-01 …"). Say "equivalent," don't claim the strings match.

---

## The same numbers, two stories

<div class="vl-anim" id="live" data-anim="live-infer" data-caption="same tranches, infer with vs. without a grant date">[ live MCP call: same {date,amount} rows → CLIFF, then + grant date → pre-grant start ]</div>

Was that first lump a **cliff** — or vesting that started **before the grant**?
The numbers can't say. **The grant date can.**

Note:
Beat 10 — live encore + the deepest payoff (~2.5 min). REFRAMED after the MCP
verification pass: the original "watch the 30% decompose cleanly anyway" was FALSE
(confirmed). What we found instead is better — and it's the user's framing: the
amount of structure you can recover grows with the context you supply.

THE LIVE DEMO — same tranche array, twice, changing only the context:
- Run 1, NO grant date: the big lump + monthly train → the inferrer folds it to a
  clean "…OVER 48 months EVERY 1 month CLIFF 12 months", cliffFolds:1. A 1-year
  cliff. (This is the fixed no-grant-date path — recovers the cliff structurally.)
- Run 2, SAME numbers, grant date supplied ON the lump's date → now it reads
  "…OVER 48 months EVERY 1 month" with a back-dated FROM DATE, no cliff. The lump
  is re-read as ~12 months of vesting that began BEFORE the grant and piled onto
  the grant date (pre-grant accrual). preGrantFolds:1.

The line: "Same column of numbers. Two honest readings — a one-year cliff, or a
start that predates the grant. From the numbers alone you genuinely cannot tell;
they're identical. The grant date is the context that resolves it. The structure
you can recover isn't fixed — it grows with what you can tell the tool."

WHY THIS IS THE TITLE PAYING OFF AGAIN: radio astronomy's inverse is ALSO
underdetermined — limited baselines mean many skies fit the same measurements
(the "dirty beam"), so CLEAN resolves it by ASSUMING structure (point sources).
Deconvolution is ill-posed; you need priors/context to pick one answer. Same here:
tranche numbers underdetermine the schedule; structural priors + the grant date
pick the reading. The title earned itself once on the algorithm (CLEAN = matching
pursuit, Beat 9) and again on the epistemics (the inverse is ill-posed, Beat 10).

FALLBACK LADDER (rehearse this):
- Network dies → play the A3 animation offline for Run 1; describe Run 2's flip
  verbally ("supply a grant date on the lump and the same numbers become a
  back-dated start, no cliff").
- Model misbehaves → cached output of BOTH runs on the next (hidden) slide.
The talk never depends on the encore landing. Only this slide needs the network.

----

### (optional, if time) one more limit

The inferrer only calls it a **cliff** when the lump is a *whole number of
installments*. A negotiated **30%** isn't — so it can't fold to a clean cliff at
all. The *derived* cliff (it fell out) recovers; the *asserted* one (typed in)
can't. The algorithm sees the Act-I fork.

Note:
OPTIONAL sub-slide — the derived-vs-asserted echo, demoted from the main thread
(grant-date ambiguity is the primary Beat-10 story now). Use only if time and
energy allow; it's a lovely callback to the Beat-3 fork but not load-bearing.

Mechanism (Q&A): the cliff-fold fires iff lump / per-installment is an integer.
25% cliff: 1200/100 = 12 ✓ folds. 30% cliff: 10800/700 = 15.43 ✗ fragments to
"[25900 VEST …OVER 37 months, 10100 VEST FROM DATE …]". It's grid alignment, not
the percentage — 8400/700 = 12 folds cleanly too. A vestlang CLIFF means "the
first k whole installments of THIS train, withheld and released," so a lump that
isn't k installments genuinely isn't that structure.

---

## The landing

<div class="vl-anim" id="curve-final" data-anim="cumulative-curve" data-caption="back to the lone Beat-1 curve">[ the single Beat-1 cumulative curve, alone ]</div>

```text
VEST OVER 48 months EVERY 1 month CLIFF 12 months
```

That's the whole language. **You've been reading it for twenty minutes.**

Note:
Beat 11 — the landing (~1.5 min). Back to the lone Beat-1 curve.

Say: I built a small language chasing "what is a cliff," and found the question
had this much structure underneath. The signal lens didn't just settle the
tradeoff — it let me run the whole thing BACKWARDS.

DSL payoff (the running thread lands): put the full statement up and note every
keyword on it already appeared in passing — VEST, FROM, OVER, EVERY, CLIFF, the
portion prefixes. "That's the whole language. You've been reading it for twenty
minutes." Arrives as recognition, not a tutorial.

Close: Every one of you represents vesting somehow — a contract, a spreadsheet, a
schema, a database. You're all already standing somewhere on that tradeoff slide,
whether you chose the spot or not. It's worth choosing on purpose.

NO adoption ask — the rest of the summit covers that, and you're part of it.

---

## Thank you

<p class="subtitle">vestlang · mattcantor.github.io/vestlang</p>

Note:
Q&A pocket answers:
- "Isn't composition more expressive?" → Over real schedules (finite lists of
  dates & amounts), no — same schedules. Composition can DESCRIBE a schedule as
  stacked overlapping pieces, which the sequential model can't hold as a form, but
  it vests to the identical result. More expressive in FORM, not power.
- "Anything composition genuinely can't express?" → No. Any schedule is a sum of
  pulses; composition has pulses, so it spans everything. Trains are compression,
  not power.
- "What about clawback?" → Not a schedule, an amendment to one. Schedule space
  only points up, which is correct. Clawback acts ON the output.
- "Should OCF adopt this?" → That's a different talk (and it's happening elsewhere
  at this summit).
- Multi-cadence (quarterly Y1 + monthly after) decomposition demo is held here for
  Q&A rather than spending Act-III time.
- "How does it decide cliff vs. pre-grant?" → By the lump's position relative to
  the grant date: a lump AFTER the grant is a cliff; a lump ON the grant is read
  as pre-grant accrual (a start that predates the grant, collapsed onto it). With
  NO grant date supplied it can't ask that question, so it folds structurally and
  recovers the cliff. (This is the Beat-10 point: structure grows with context.)
- "Why didn't the 30% cliff fold?" → A vestlang CLIFF is "the first k WHOLE
  installments of this train, withheld and released," so the lump must be an
  integer multiple of the per-installment amount. 25% cliff: 1200/100 = 12 ✓.
  30%: 10800/700 = 15.43 ✗ — not a whole number of installments, so it's a portion
  imposed from outside the cadence, not a cliff. It still round-trips, just as a
  two-statement list. Grid alignment, not the percentage: 8400/700 = 12 folds.
