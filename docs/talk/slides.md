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
VEST FROM grantDate OVER 48 months EVERY 1 month CLIFF 12 months
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
lesson. VERIFY exact grammar (CLIFF placement, EVERY/OVER order) via the MCP
linter before this ships.

----

### The asserted one, for contrast

```text
.3 VEST FROM grantDate OVER 12 months EVERY 12 months
.7 VEST FROM grantDate + 12 months OVER 36 months EVERY 1 month
```

The **30%** has to be **stated**. Same schedule, different road.

Note:
Guardrail sub-slide. The "just write the number" approach lands on the very same
schedule — it just gets there by stating the amount. Same destination. The point
is not that one is wrong; it's that only the derived cliff makes the number FALL
OUT. Verify these two lines in the linter too.

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
4. Residual zero. Out drops the DSL — the EXACT line from Beat 5.

Accuracy guardrail: keep "Fourier / frequency domain" as a SPOKEN metaphor only.
The method is time-domain matching pursuit, not an FFT. Deconvolution /
matching-pursuit / spectroscopy language is all literally correct.

----

### And it falls out as the language

```text
VEST FROM grantDate OVER 48 months EVERY 1 month CLIFF 12 months
```

The decomposition's output *is* vestlang.

Note:
The DSL the inferrer emits is the same line the room saw in Beat 5. The language
reappears here not as something taught, but as the thing the decomposition
PRODUCES. Round-trip verified against the input before it's shown.

---

## Live: feed it numbers, get the rule

<div class="vl-anim" id="live" data-anim="live-infer" data-caption="vestlang_infer_schedule on a fresh, messier array">[ live MCP call: paste {date, amount} rows → inferred DSL, round-trip verified ]</div>

The **30%** one — negotiated, not derived. Watch it decompose anyway.

Note:
Beat 10 — live encore (~1.5 min). Run vestlang_infer_schedule for real on a
DIFFERENT, messier array — the 30% asserted cliff (pulse + train, two components).
Out comes DSL, round-trip-verified against the input. Ties back to the fork:
"here's one where the number was negotiated, not derived — watch it still
decompose cleanly." Proves the tool generalizes beyond the hero example.

FALLBACK LADDER (rehearse this):
- Network dies → play the A3 animation offline; "same decomposition,
  pre-rendered."
- Model misbehaves → cached output on the next (hidden) slide.
The talk never depends on the encore landing. Only this slide needs the network.

---

## The landing

<div class="vl-anim" id="curve-final" data-anim="cumulative-curve" data-caption="back to the lone Beat-1 curve">[ the single Beat-1 cumulative curve, alone ]</div>

```text
VEST FROM grantDate OVER 48 months EVERY 1 month CLIFF 12 months
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
