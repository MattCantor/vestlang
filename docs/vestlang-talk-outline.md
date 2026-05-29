# The Lie Hiding in Every Cliff
### A 15-minute deep dive into how we represent vesting
*Speaker outline — vestlang as the worked example, not the product*

---

## The one idea
A vesting cliff looks like the simplest thing in the world. Follow the question
*"what is a cliff, really?"* honestly, all the way down, and it opens up the entire
design space of how we represent vesting — and you can't reach the bottom without
making choices nobody told you you were making.

**Takeaway the room leaves with:** You are always standing somewhere on a tradeoff
when you represent vesting. It's worth choosing your spot on purpose.

**The discipline for the whole talk:** the word *express* has two meanings. Keep them
apart. "The same **schedules**" = same outputs. "The same **ways of writing** a
schedule" = same descriptions. The two models match on the first and differ on the
second. Every confusion comes from sliding between them.

---

## Arc at a glance (≈15 min)

| Beat | Time | What happens |
|------|------|--------------|
| 1 | ~1.5 min | Here's a cliff. Everyone pictures the same thing. |
| 2 | ~2 min | The cliff amount *fell out* — it's a gate, not an amount. |
| 3 | ~1.5 min | "But what about 30% at one year?" — the asserted cliff. The fork. |
| Interlude | ~1 min | A schedule is a signal: pulses + trains, stacked. (The nerdy hook.) |
| 4 | ~2.5 min | Follow the derived path: build the hard cliff by *stacking* components. |
| 5 | ~2.5 min | The catch: chasing elegance drags in a second decision (where's the start?). |
| 6 | ~2.5 min | No free lunch — the real tradeoff, plus the monotonicity flourish. |
| 7 | ~1.5 min | The landing: I built a language and found a question, not an answer. |

---

## Beat 1 — Here's a cliff (~1.5 min)
**On screen:** a single cumulative-vesting curve. 4-year monthly, 1-year cliff.
The flat stretch, then the step at month 12, then the staircase.

**Say:** Everyone here knows this shape. Four-year vest, one-year cliff. A lawyer
pictures it, an engineer pictures it, a founder pictures it — and you all picture
the *same* thing. That agreement is rare. Hold onto it, because it's about to break.

---

## Beat 2 — The amount fell out (~2 min)
**On screen:** same curve; highlight the step at month 12; annotate "25% = 12/48".

**Say:** The cliff releases 25% at the one-year mark. Where did 25% come from?
Nobody chose it. It's just 12 months out of 48. The vesting was accruing the whole
time — the cliff didn't *add* anything, it *withheld* and then released exactly what
had already accrued. So a cliff isn't an amount. It's a **gate**. The number on the
step is a *consequence* of the schedule, not an input to it.

**Beat function:** first reframe. The familiar thing is not what they thought it was.

---

## Beat 3 — The asserted cliff (the fork) (~1.5 min)
**On screen:** two curves side by side, identical-looking steps at month 12.
Label them only after the question.

**Say:** Now here's a schedule you've also all seen: "30% at one year, then the rest
monthly." Looks the same on the chart — flat, step, staircase. But this 30% did
**not** fall out of anything. Someone negotiated it and wrote it down. So we have two
cliffs that look identical and are secretly opposites: one **derived**, one
**asserted**. That tiny distinction — did the number fall out, or did someone type
it — is a fork in the road. The rest of the talk is walking down it.

---

## Interlude — A schedule is a signal (~1 min, lead-in to Beat 4)
**On screen:** no notation. Show one schedule as a row of bars on a date line, then
two faint "component" rows beneath it that add up to the top row.

**Say (the nerdy hook, in plain words):** Here's the way I started thinking about it.
A schedule is just **shares landing on dates** — a little signal. And you can build
that signal out of simpler ones. Two kinds of building block: a **pulse** — a single
lump on one date, which is exactly what a cliff is — and a **train** — a regular run of
equal pulses, which is exactly ordinary month-by-month vesting. You make a whole
schedule by **stacking** these up: where two components land on the same date, their
shares add. **Schedule = sum of component signals.** That's the whole mental model.

*(Completeness, spoken — your "no gap" proof without symbols:)* And notice: you could
always build *any* schedule at all just by dropping one pulse on every date you care
about. So there's nothing you can't express. The fancier building blocks — the trains —
aren't there to let you say *more*. They're there so you don't have to spell out every
pulse by hand. A four-year vest is **one train, not forty-eight pulses.**

---

## Beat 4 — The derived path pays off (~3 min)
**On screen:** the 30% schedule, then: a single **pulse** and a **train** appear
separately, then stack into the same curve. Optionally one or two lines of vestlang
syntax (the "one glimpse" dial).

**Say:** Take the derived idea seriously: what if a cliff is *always* a consequence,
never an asserted number? Then you stop describing vesting as amounts and start
describing it as **shape** — pulses and trains. And here's the surprising part: you
can build that "30% at one year" schedule **without ever typing 30%**. You stack a
couple of simple components and the 30% *emerges* from where they land.

*(Guardrail — say this so you don't overclaim:)* To be clear, the simpler "just write
the number" approach lands on the very same schedule — it just gets there by stating
the amount directly. Same destination, different road.

**Optional syntax glimpse:**
```
.3 VEST FROM grantDate OVER 12 months EVERY 12 months
.7 VEST FROM grantDate + 12 months OVER 36 months EVERY 1 month
```
Two small pieces. No magic number. That's a little language for vesting.

---

## Beat 5 — The catch: elegance moves the furniture (~2.5 min)
**On screen:** the two pieces from Beat 4, with a question mark over the start of the
second piece. "where does this begin?"

**Say:** But composing pieces forces a question the single-schedule picture never had
to answer: *where does each piece start?* I went in trying to clean up **cliffs**, and
somewhere along the way I'm now making decisions about where vesting **begins** — and
whether the second piece picks up exactly where the first left off, or floats on its
own. One innocent question — what's a cliff? — quietly dragged a second one into the
room. That's what I mean by a design space *unfolding*: you pull one thread and three
others move.

**Beat function:** deliver on the "unfolds into a whole design space" promise — not by
listing the space, but by letting the audience *feel* a second decision appear.

---

## Beat 6 — No free lunch (the fulcrum) (~2.5 min)
**On screen — THE CENTERPIECE SLIDE:**

> **Two honest ways to represent vesting**
> *Both express the same schedules. They differ entirely in what that expression
> costs you.*

**LEFT — Hoist the start, vest sequentially**
*One start. Statements apply in order. Cliffs may name their own amount.*
- The author can barely make a mistake — pieces can't overlap or gap. **Safe by construction.**
- Expresses anything, including unusual cliffs, by writing the amount down.
- But push that far enough and you've reinvented a spreadsheet of dates and amounts.
  **There's no real language there.**
- Easy to read, compare, and trust — *because* it's rigid.

**RIGHT — Free the start, compose proportional pieces**
*No privileged start. Pieces anchor independently and sum. Cliffs emerge.*
- Amounts stay **derived from structure** — a cliff is a consequence, not a typed number. **It's genuinely a language.**
- Keeps every schedule as a **sum of component signals** — it can *describe* a schedule
  as overlapping, stacked pieces; the sequential model can't hold that form, though it
  vests to the same result.
- But the same power lets an author quietly build something they didn't mean.
  **The care is on the author.**
- And the same schedule can be written several ways — harder to compare and trust
  without evaluating it.

> **Bottom band:** The trade isn't power vs. safety — both are powerful.
> It's safety-by-construction vs. being-a-language. **You pay for elegance in trust.**

**Say:** Neither column is wrong. They're two coherent positions. One is hard to break
and easy to read, and at its limit stops being a language at all. The other is a real
language with one clean idea, and it hands you a tool sharp enough to cut yourself.
Same schedules out the bottom. Different costs.

**Optional nerd flourish (10 sec, also pre-empts the clawback question):** One nice
thing falls out of the signal view. Every building block only ever *adds* shares —
they all point up. So a schedule only ever climbs. And that's exactly right, because
vesting only goes one way. When shares get *taken back* — a clawback — that isn't part
of the schedule. It's an **amendment** to it: a later event, for cause, acting on what
the schedule produced. The schedule says what you earn over time; the amendment says
what got revoked. Keeping them apart isn't a simplification — it's the honest model.

---

## Beat 7 — The landing (~2 min)
**On screen:** back to the single Beat-1 curve, alone.

**Say:** I built a small language chasing this — it's called vestlang. I went in
trying to decide the right answer. I came out convinced the value wasn't the answer;
it was discovering the question had this much structure underneath it. Every one of
you represents vesting somehow — in a contract, a spreadsheet, a schema, a database.
Which means every one of you is already standing somewhere on that slide, whether you
chose the spot or not. That's the whole talk: it's worth choosing on purpose.

---

## Things deliberately LEFT OUT (and why)
- **The formal three-axis triangle** (coherence/purity/expressiveness as named axes):
  costs a slide of setup the 15-min payoff doesn't repay. Say "tradeoff," not the axes.
- **QUANTITY vs PORTION / completeness proof in symbols:** the *idea* is in the
  Interlude in plain words ("any schedule is a sum of pulses"); the formal version is a
  30-minute item. Don't claim a superset — the two models are output-equivalent.
- **The full 8-item weaknesses list:** Beat 6 gives the honest version in intuition form.
- **OCF schema placement / adoption ask:** this is the "journey" talk, not the proposal.

## Pocket answers for Q&A
- *"Isn't composition more expressive?"* → "Over real schedules — finite lists of dates
  and amounts — no. They express the same schedules. Composition can *describe* a
  schedule as stacked, overlapping pieces, which the sequential model can't hold as a
  form — but it vests to the identical result. So it's not more powerful; it's more
  expressive in *form*. The whole difference is who's likelier to make a mistake, and
  which one you can read without running it."
- *"Is there anything composition genuinely can't express?"* → "No — and there's a clean
  reason. Any schedule is just a sum of pulses, one per date; composition has pulses, so
  it spans everything. The trains aren't there to add power, just to keep you from
  spelling out every pulse by hand."
- *"What about clawback?"* → "That's not a schedule, it's an amendment to one — a later
  event that revokes vested shares, for cause. The schedule space only points up, which
  is correct, because vesting does. Clawback acts *on* the output; it isn't a term in it."
- *"Should OCF adopt this?"* → "That's a different talk. This one's about seeing the
  tradeoff you're already living with."

## The one rule for staying consistent on stage
Never let *express* mean outputs and descriptions in the same breath.
Outputs → "the same **schedules**." Descriptions → "the same **ways of writing** it."
Same on the first, different on the second.
