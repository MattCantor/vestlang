# Vesting Schedules as Radio Astronomy — fused arc

*Working title:* **Vesting Schedules as Radio Astronomy** *(subtitle TBD — see
title shortlist below). Beat language was first drafted under the old title "The
Lie Hiding in Every Cliff," which survives as the Act-I hook ("a cliff is a gate,
not a number").*

*Working beat sheet for the OCTC summit talk (~20–25 min). Supersedes the
structure in `vestlang-talk-outline.md`; that file's language is still the
source of truth for individual beats marked **[KEEP]**.*

---

## The spine (one sentence)

**A schedule is a signal — and that one lens lets you do three things in
sequence: re-see what a cliff is, see why there are two honest ways to write a
schedule down, and then run the whole thing *backwards* to recover the schedule
from raw numbers.**

The signal model is **not** one of the two representations being compared. It is
the *way of seeing* that reveals there are two — and the same picture that
teaches it forward (pulses → schedule) is the picture that does inference
backward (numbers → pulses). The talk literally runs one animation forward, then
backward.

**The `express` discipline still governs everything:** "the same **schedules**"
= same outputs; "the same **ways of writing** a schedule" = same descriptions.
Same on the first, different on the second.

---

## Arc at a glance

| Act | Beat | ~min | What happens | Status |
|-----|------|------|--------------|--------|
| I | 1 — Here's a cliff | 1.5 | One curve. Everyone pictures the same thing. | KEEP |
| I | 2 — The amount fell out | 2 | 25% = 12/48. A cliff is a *gate*, not an amount. | KEEP |
| I | 3 — The asserted cliff (the fork) | 1.5 | "30% at one year." Derived vs. asserted. | KEEP |
| I | 4 — **A schedule is a signal** | 3 | Pulses + trains, stacked. **The lens.** | PROMOTE |
| II | 5 — Build the cliff by stacking | 3 | **25%** *emerges* — never typed. (anim, forward) | KEEP |
| II | 6 — Elegance moves the furniture | 2 | Composing forces "where does each piece start?" | KEEP |
| II | 7 — No free lunch (centerpiece) | 3 | Two ways to *write the same signal* down. | KEEP |
| III | 8 — The inverse question | 1.5 | Real life hands you the numbers, not the DSL. | NEW |
| III | 9 — **Watch it decompose** | 2.5 | Same anim, backward: numbers → atoms → DSL. | NEW |
| III | 10 — Live encore | 1.5 | `infer_schedule` runs for real. | NEW |
| — | 11 — The landing | 1.5 | One language; a question with structure under it. | EVOLVE |

≈ 23 min of content + breathing room → comfortable in the 20–30 slot.

---

## ACT I — What is a cliff, really? *(the journey earns the lens)*

### Beat 1 — Here's a cliff **[KEEP]**
Single cumulative-vesting curve, 4-yr monthly, 1-yr cliff. Flat → step at month
12 → staircase. *Everyone pictures the same thing; that agreement is rare; it's
about to break.*

### Beat 2 — The amount fell out **[KEEP]**
Highlight the step. 25% = 12/48. Nobody chose 25% — it's a consequence. A cliff
is a **gate**, not an amount.

### Beat 3 — The asserted cliff, the fork **[KEEP]**
"30% at one year, then the rest monthly." Same *shape* on the chart (flat → step
→ staircase), but the 30% was *typed*, not derived. The number is deliberately
≠ 25%: a derived cliff can only land on a clean count fraction (25% = 12/48),
so **30% can never fall out of a 4-yr monthly grid — it must be asserted.** Two
cliffs that look the same and are secretly opposites. The fork the rest of the
talk walks down.

### Beat 4 — A schedule is a signal **[PROMOTE — was the 1-min interlude]**
This is now the hinge of the whole talk, not an aside.

- **Vocabulary (anim A1):** a schedule is shares landing on dates — a little
  signal. Two building blocks: a **pulse** (one lump on one date — exactly a
  cliff) and a **train** (a regular run of equal pulses — exactly ordinary
  monthly vesting). Stack them; where they land together, shares add.
  **Schedule = sum of component signals.**
- **Completeness, spoken:** you could build *any* schedule by dropping one pulse
  per date, so there's nothing you can't express. Trains aren't there to say
  *more* — they're there so you don't spell out 48 pulses by hand. A four-year
  vest is **one train, not forty-eight pulses.**
- **The promotion move (new framing, ~20 sec):** notice what we just did — we
  didn't pick a *representation*, we picked a *way of looking*. We can now point
  this lens at any schedule at all, including the rigid one. Hold that thought.

---

## ACT II — Two honest ways to write the same signal *(the tradeoff)*

### Beat 5 — The derived path pays off **[KEEP — example switched to 25%]**  *(anim A2 — forward)*
Build the **derived 25% cliff — the Beat-1 curve itself** — by stacking. A
48-month monthly train, gated by a 12-month cliff: the first 12 installments are
withheld and released as one lump. The **25% step *emerges* from 12/48** — you
never type a percentage. *This* is "a cliff is a consequence, not an input."

Contrast (the guardrail, now sharper): the **30%** asserted cliff *can't* be
built this way — no clean count gives 30% over 48 months — so you must state the
amount (`.3` / `.7`). Both models can express it; neither makes it fall out. That
is exactly the derived-vs-asserted fork, made concrete.

Syntax glimpse (the "one glimpse" dial) — *verify exact grammar against the spec
when drafting `slides.md`*:
```
# derived — 25% emerges, nothing typed
VEST FROM grantDate OVER 48 months EVERY 1 month CLIFF 12 months

# asserted — the 30% must be stated
.3 VEST FROM grantDate OVER 12 months EVERY 12 months
.7 VEST FROM grantDate + 12 months OVER 36 months EVERY 1 month
```

### Beat 6 — The catch: elegance moves the furniture **[KEEP]**
Composing pieces forces a question the single curve never had to answer: *where
does each piece start?* One innocent question (what's a cliff?) quietly drags a
second one (where does vesting begin?) into the room. The design space unfolds —
pull one thread, three others move.

### Beat 7 — No free lunch (centerpiece) **[KEEP — reframed by the spine]**
The centerpiece slide, now explicitly framed: *both columns are notations over
the **same signal**.* The signal is the neutral ground the comparison stands on.

- **LEFT — hoist the start, vest sequentially:** safe by construction; expresses
  anything by writing the amount down; pushed far enough it's a spreadsheet —
  no real language; easy to read *because* it's rigid.
- **RIGHT — free the start, compose proportional pieces:** amounts stay derived
  from structure — genuinely a language; keeps every schedule as a sum of
  component signals; the same power lets an author build what they didn't mean;
  the same schedule can be written several ways — harder to compare without
  evaluating.
- **Bottom band:** not power vs. safety — both are powerful. It's
  safety-by-construction vs. being-a-language. **You pay for elegance in trust.**
- **Monotonicity / clawback flourish (10 sec):** every building block only adds
  shares, so a schedule only climbs — correct, because vesting only goes one
  way. A clawback isn't part of the schedule; it's an **amendment** acting on its
  output. (Also pre-empts the clawback Q.)

---

## ACT III — Reading the signal back out *(the payoff — NEW)*

### Beat 8 — The inverse question **[NEW]**
Everything so far ran one direction: **DSL → schedule.** But real life never
hands you the DSL. It hands you a cap table: a list of `{date, amount}` rows. And
asks, "what *is* this — what's the rule?" If a schedule is a signal, then reading
its structure back out of raw numbers is just **decomposition.** The forward
lens has an inverse, and we already have the vocabulary for it.

**The radio-astronomy reveal (earns the title, on stage):** don't say "now let's
infer." Say: *"I want to show you something."* → run the decomposition animation
→ *"This is how a radio telescope turns a smeared blur into a picture of a galaxy.
It's also how we're about to turn a column of numbers back into a vesting
schedule. Same algorithm."* The inferrer is **matching pursuit**; radio
interferometry's **CLEAN** (Högbom, 1974) is the same greedy deconvolution — find
the brightest component in the residual, subtract a scaled copy of the
instrument's response, recurse on what's left, accumulate the pieces. Naming the
isomorphism is the talk's nerd payoff and the moment the title pays off.
*(Accuracy guardrail: keep "Fourier / frequency domain" as spoken metaphor only —
the method is time-domain matching pursuit, not an FFT. Deconvolution /
matching-pursuit / spectroscopy language is all literally correct; don't claim a
transform you don't run.)*

### Beat 9 — Watch it decompose **[NEW — Act III centerpiece, anim A3 = A1/A2 run backward]**
Take the **Beat-1 curve itself** — the 4-yr/1-yr (25%) cliff — now as raw
numbers. The shape everyone pictured at minute one comes back as a list of
`{date, amount}` rows. Close the loop. Animate matching pursuit:

1. Here are the bars (the signal) — no labels, just dates and heights.
2. Find the dominant regular component → a 48-month **train** lifts out. Subtract.
3. What's left is one lump at month 12 → folds back into the **12-month cliff**.
4. Residual is zero. Out drops the DSL — *the exact line from Beat 5.*

Each step *is* a turn of CLEAN's loop (peak → subtract instrument response →
recurse on residual). The animation should make the "subtract, look at what's
left" rhythm visible — that rhythm is the whole connection to radio astronomy.

The point lands without a word: **the picture that taught the idea forward is the
algorithm that recovers it backward.** That visual identity *is* the spine.
*(Stretch: a second, messier multi-cadence array — quarterly year 1 + monthly
after — to show decomposition shines where template-matching would fail.)*

### Beat 10 — Live encore **[NEW]**
Run `vestlang_infer_schedule` for real on a *different, messier* array — the
**30% asserted** cliff (pulse + train, two components) → out comes the DSL,
round-trip-verified against the input. Ties back to the fork: "here's one where
the number was negotiated, not derived — watch it still decompose cleanly." And
it proves the tool generalizes beyond the hero example. "It actually does this."

- **Fallback ladder:** network dies → play the A3 animation (offline) and say
  "this is the same decomposition, pre-rendered." Model misbehaves → cached
  output on the next slide. The talk never depends on the encore landing.

### Beat 11 — The landing **[EVOLVE from Beat 7 of the old outline]**
Back to the lone Beat-1 curve. I built a small language chasing "what is a
cliff," and found the question had this much structure underneath. The signal
lens didn't just settle the tradeoff — it let me run the whole thing *backwards*.

**DSL payoff (the running thread lands):** put the full statement on screen and
note that every keyword on it already appeared, in passing, somewhere in the talk
— `VEST`, `FROM`, `OVER`, `EVERY`, `CLIFF`, the portion prefixes. "That's the
whole language. You've been reading it for twenty minutes." It arrives as
recognition, not a tutorial.

Every one of you represents vesting somehow — a contract, a spreadsheet, a schema,
a database. You're all already standing somewhere on that tradeoff slide, whether
you chose the spot or not. **It's worth choosing on purpose.**

---

## Running thread: the DSL (decided in Q2)

Don't teach the DSL; *seed* it. Let real vestlang fragments appear only where they
earn their place, so the Beat-11 reveal is recognition rather than introduction:
- **Beat 5** — the derived `... CLIFF 12 months` line and the asserted `.3/.7` pair.
- **Beat 7** — maybe one line per column on the no-free-lunch slide (sequential vs.
  composed), if it clarifies rather than clutters.
- **Beat 9** — the inferrer's *output* is DSL, so the language reappears as the
  thing the decomposition produces.
- **Beat 11** — the full statement, as payoff: "you've already seen every piece."
Keep each fragment small and real (lint through the MCP tools before it ships).

---

## The three hero animations (the real build)

All three share **one visual grammar**: bars on a date line up top, component
rows beneath that sum to the top row. Build it once, reuse three times. The
forward/backward reuse of the *same* component is the talk's thesis made visible.

- **A1 (Beat 4):** pulse, train, and stacking → sum. Vocabulary builder.
- **A2 (Beat 5):** stack pulse + train → the 30% cliff emerges (forward).
- **A3 (Beat 9):** matching-pursuit decomposition of raw bars → atoms →
  residual → DSL (A1/A2 played backward).

Supporting (static or simple): Beat 1–2 cumulative curve; Beat 3 two-curve fork;
Beat 7 no-free-lunch two-column slide.

---

## Open design questions

1. **Act III worked example** — RESOLVED: hero through-line is the **25%
   4-yr/1-yr cliff = the Beat-1 curve** (it's the only cliff that can *emerge*,
   and reusing Beat 1 gives maximal unity). Live encore = the **30% asserted**
   cliff (different, messier, ties back to the fork). Still open: add a
   multi-cadence stretch (quarterly→monthly) in Beat 9, or save it for Q&A?
2. **Syntax exposure** — RESOLVED: use real vestlang DSL wherever it *helps*, but
   never push it; never turn the talk into a tutorial. Treat it as a **running
   thread** (see below), seeding small fragments through the talk and **landing
   the whole DSL at the end** — "here's the language; you've already seen every
   piece of it."
3. **Adoption ask** — RESOLVED: leave it unsaid. The rest of the summit covers
   adoption, and the speaker is part of that; this talk stays a pure journey.
4. **Title** — RESOLVED (working): **Vesting Schedules as Radio Astronomy**,
   subtitle TBD. The CLEAN reveal in Beat 8 earns it on stage. Shortlist kept
   below in case the program listing wants something less oblique.

## Title shortlist

- **Vesting Schedules as Radio Astronomy** ← *working pick*
  *— the deconvolution algorithm that images the sky, pointed at a cap table*
  Most fun, and accurate: CLEAN ≈ matching pursuit. Earned by the Beat-8 reveal.
- **Deconvolving the Cliff** *(safe nerdy hedge for the program listing)*
  *— a vesting schedule is a signal; here's how you read it back*
- **The Spectroscopy of Vesting**
  *— every schedule has a spectrum; this is how to read its lines*
- **Vesting Is a Pulse Train**
  *— the signal hiding in every cap table* (true; "train" = the Beat-4 word)
- **The Lie Hiding in Every Cliff** *(original; now demoted to the Act-I hook)*
- *Avoid as a title:* "The Fourier Transform of a Cliff" — names a method the
  inferrer doesn't use. Fine as a spoken metaphor, wrong on the marquee.

## Deliverable / hosting

reveal-md → `reveal-md slides.md --static apps/docs/static/talk` → committed →
live at `mattcantor.github.io/vestlang/talk/`. Offline fallback for the room:
run `reveal-md slides.md` locally (port 1948) and/or `npx serve` the static
folder. Only the Beat-10 live encore needs the network.
