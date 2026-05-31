# Draft email — Carta vesting model question

A draft outreach to a Carta contact to resolve how Carta represents conditional /
pending vesting (the `milestoneName` vs. `performanceCondition` ambiguity documented in
[`carta-conditional-vesting.md`](./carta-conditional-vesting.md)). Carta's published schema
and API reference define both fields but never relate them, so the question can only be
settled by Carta directly or by a sample payload. Replace `[Name]` / `[Your name]` before
sending.

---

**Subject:** Carta vesting model — milestones vs. performance conditions (for an OCF mapping)

Hi [Name],

**Context.** I'm mapping OCF (the Open Cap Format) onto Carta's Cap Table Data Schema
(v1alpha1) — making OCF round-trip cleanly into Carta's shape. Vesting is the one place I keep
getting stuck, and I've gone as far as the published schema and API reference take me; the rest
is something only your team can settle. I've tried to make this answerable without much digging
— and a quick call works too if that's easier.

**Where I'm stuck.** In a `VestingScheduleTemplate`, each `VestingPeriod` has *two* fields that
both look like they encode a "this portion vests when condition X is met" gate, but the docs
define them independently and never relate them:

- `milestoneName` (string) — *"The name of the milestone for milestone-based periods."*
- `performanceCondition` (object) — *"The performance condition associated with this period,"*
  where `PerformanceCondition` has `type` ∈ {`EVENT_NON_MARKET`, `PERFORMANCE_NON_MARKET`,
  `MARKET`} and `status` ∈ {`ACHIEVED`, `NOT_ACHIEVED`, `NOT_EVALUATED`}.

I can't tell from the schema whether these are two names for one concept or two different
mechanisms.

**The two readings I can construct — which is correct?**

- **(A) One mechanism.** A "milestone" is just a `performanceCondition` of
  `type = EVENT_NON_MARKET`, and `milestoneName` is a convenience label.
- **(B) Two mechanisms.** `milestoneName` is a lightweight named/binary gate and
  `performanceCondition` is the structured (possibly graded) one, and a period uses one or the
  other.

**Two concrete cases to ground it** — for each, which fields would Carta populate?

1. A tranche that vests on a **discrete corporate event** (e.g., an IPO) that hasn't happened
   yet.
2. A tranche that vests on a **performance metric** (e.g., hitting $50M revenue) that hasn't
   been evaluated yet.

For each: do you set `milestoneName`, a `performanceCondition` (and which `type` / `status`),
or both — and what's the template's `vestingScheduleType` (`MILESTONE` vs. `HYBRID`)?

**The pending state.** For a condition that hasn't occurred, is the full representation
`status = NOT_EVALUATED` (with `evaluationDate` / `payoutPercentage` empty,
`min`/`maxPayoutPercentage` giving the range) on the template — and on the *materialized*
vesting event, `vested = false`, `performanceCondition = true`, `vestDate` omitted? Anything
I'm missing?

Honestly, **a sample JSON payload for one grant of each type above (ideally still pending)**
would answer all of this in one shot and save you writing it out.

This detail drives how faithfully OCF can represent contingent vesting, so I'd rather confirm
than guess. Really appreciate the help.

Best,
[Your name]
