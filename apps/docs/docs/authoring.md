---
title: Authoring from a Narrative
sidebar_position: 6
---

A common starting point is not a clean spec but a loose description — "four years,
monthly, one-year cliff" — plus a few hard figures: a tranche disclosed in a proxy
footnote, a couple of fiscal-year-end balances. That falls between the tools.
`vestlang_infer_schedule` wants the whole release stream; bare
`vestlang_verify_observations` assumes you already have a candidate to test. What
you actually do is compose them: draft a schedule from the narrative, encode the
known figures as anchors, verify, and refine until the anchors line up. This page
is that loop.

## The loop

1. **Propose.** Draft the DSL from the narrative. Validate it with `vestlang_lint`
   (and `vestlang_parse` for syntax) before trusting it; fix any error-severity
   diagnostic and lint again. See [the grammar](./dsl_grammar.md) and
   [examples](./examples.md) for the shapes.
2. **Verify.** Call `vestlang_verify_observations` with the draft, the grant
   context, and the known figures encoded as observations. It grades every figure
   as a percent-of-grant gap against the schedule's own prediction and reports
   `matches` plus a per-figure check on each row.
3. **Refine.** Read the checks. An exact match confirms the reading; a gap tells
   you what to change — a wrong cliff, the wrong cadence, a day-of-month
   convention. Adjust the DSL and verify again.

## Mapping the narrative to anchors

The known figures are what pin a draft to reality. Two shapes cover almost
everything:

| In the description | Observation |
| --- | --- |
| A specific release — "N shares vested on a given date" (a proxy footnote) | a `tranche`, `{ date, amount }` |
| A point-in-time count — "M shares unvested at fiscal year end" | a `balance`, `{ date, vested?, unvested? }` |

A tranche is exact-match on its date: if the schedule predicts nothing on that
day, the check fails and the row points at the nearest predicted installment. A
balance is a cumulative snapshot; supply the vested figure, the unvested figure,
or both, and each becomes its own check. These are the observation kinds
`vestlang_verify_observations` already takes — the recipe is just the mapping from
words to them.

## Worked example: narrative plus two tranches

The description: *the whole grant vests over four years, monthly, after a one-year
cliff.* The grant is 592,560 shares dated 2023-09-30. A proxy footnote discloses
two releases: 148,140 shares on 2024-09-30 and 12,345 on 2024-10-30.

The narrative drafts straight into:

```vest
VEST OVER 4 years EVERY 1 month CLIFF 1 year
```

`vestlang_lint` is clean, so verify it against the two disclosed tranches:

```json verify-input=happy-path
{
  "dsl": "VEST OVER 4 years EVERY 1 month CLIFF 1 year",
  "grant_date": "2023-09-30",
  "grant_quantity": 592560,
  "observations": [
    { "kind": "tranche", "date": "2024-09-30", "amount": 148140 },
    { "kind": "tranche", "date": "2024-10-30", "amount": 12345 }
  ]
}
```

```json verify-output=happy-path
{
  "matches": true,
  "worstGap": 0,
  "tolerance": { "kind": "percent", "value": 5 },
  "rows": [
    { "check": { "predicted": 148140, "observed": 148140, "gap": 0 } },
    { "check": { "predicted": 12345, "observed": 12345, "gap": 0 } }
  ]
}
```

Both tranches land exactly: the cliff releases twelve months of the monthly rate
(148,140 = 12 × 12,345) and the next month confirms the cadence. `matches` is
true and `worstGap` is 0.

### The month-end wrinkle

The grant date here is 2023-09-30 — the last day of September, chosen on purpose.
A month-end start hides a day-of-month decision, and it shows up two different
ways.

**Written into the DSL.** If you anchor the start with a literal date,
`vestlang_lint` catches it:

```vest
VEST FROM DATE 2023-09-30 OVER 4 years EVERY 1 month CLIFF 1 year
```

Linting this raises `ambiguous-month-end-start` (info severity): later tranches
pin to day 30 of each month unless you set the day-of-month convention to
`LAST_DAY_OF_MONTH`, so on a 31-day month they land on the 30th, not the last day.

**Implicit at a month-end grant date.** The draft above has no `FROM`, so the
start defaults to the grant date, 2023-09-30 — the same month-end, but now the
linter never sees it. `vestlang_lint` reads only the DSL and is blind to the grant
date, so it stays silent; there is no `ambiguous-month-end-start` to warn you. The
behavior surfaces only when you verify or evaluate. Under the default convention
the monthly tranches land on day 30 — 2024-10-30, 2024-11-30, 2024-12-30,
2025-01-30, then 2025-02-28 where day 30 clamps — not on the last day of each
month. That is why
the second disclosed tranche above is dated 2024-10-30 and matches. Had the filing
shown 2024-10-31 instead, the exact-match check would fail and point at the 30th —
your signal to set `vesting_day_of_month` to `LAST_DAY_OF_MONTH` and verify again.

## Worked example: telling rival readings apart

When the description is vague about cadence — "vests over four years, roughly
monthly" — and the anchors are sparse, more than one reading can pass. The move is
to draft each rival, verify each against the *same* anchors, and compare
`worstGap`, the largest per-check gap.

The grant is 48,000 shares dated 2023-01-01, no cliff. Two fiscal-year-end
unvested balances are known: 37,000 at 2023-12-31 and 25,000 at 2024-12-31.

A monthly reading:

```json verify-input=monthly
{
  "dsl": "VEST OVER 4 years EVERY 1 month",
  "grant_date": "2023-01-01",
  "grant_quantity": 48000,
  "observations": [
    { "kind": "balance", "date": "2023-12-31", "unvested": 37000 },
    { "kind": "balance", "date": "2024-12-31", "unvested": 25000 }
  ]
}
```

```json verify-output=monthly
{
  "matches": true,
  "worstGap": 0,
  "rows": [
    { "checks": [ { "figure": "unvested", "predicted": 37000, "observed": 37000, "gap": 0 } ] },
    { "checks": [ { "figure": "unvested", "predicted": 25000, "observed": 25000, "gap": 0 } ] }
  ]
}
```

A quarterly reading, against the same two balances:

```json verify-input=quarterly
{
  "dsl": "VEST OVER 4 years EVERY 3 months",
  "grant_date": "2023-01-01",
  "grant_quantity": 48000,
  "observations": [
    { "kind": "balance", "date": "2023-12-31", "unvested": 37000 },
    { "kind": "balance", "date": "2024-12-31", "unvested": 25000 }
  ]
}
```

```json verify-output=quarterly
{
  "matches": true,
  "worstGap": 4.2,
  "tolerance": { "kind": "percent", "value": 5 },
  "rows": [
    { "checks": [ { "figure": "unvested", "predicted": 39000, "observed": 37000, "gap": 4.2 } ] },
    { "checks": [ { "figure": "unvested", "predicted": 27000, "observed": 25000, "gap": 4.2 } ] }
  ]
}
```

Both pass. That is the trap: **`matches: true` on its own is weak evidence.** The
default tolerance is 5% of the grant, which on a grant this size absorbs about two
months of cadence drift — enough to wave the wrong quarterly reading through at a
4.2% gap. `worstGap` is what separates them: 0 for monthly, 4.2% for quarterly.
Two ways to act on it:

- **Compare the gaps.** The monthly reading fits exactly and the quarterly one
  drifts; prefer the exact fit.
- **Tighten the tolerance.** Pass a smaller `tolerance` (a percent or an absolute
  share count) so a 4.2% drift no longer counts as a match.

Sometimes the anchors genuinely cannot decide. If every rival tied at `worstGap`
0.0 — the balances happen to fall where all the cadences agree — then the evidence
does not discriminate at all. Say so plainly: fall back to the narrative for the
cadence and surface the ambiguity rather than picking one silently.

## When not to reach for `vestlang_infer_schedule`

`vestlang_infer_schedule` turns a full `{ date, amount }` stream into exact DSL,
and it is the right tool when you hold the entire release history. But it
assumes the tranches are the complete grant. Hand it a sparse, partial set — a footnote
tranche or two, a year-end balance — and it will not refuse. It reads those few
points as the whole grant and returns a confident but wrong schedule, with an
implied grant quantity far below the real one. Sparse partial evidence is exactly
what this recipe is for: draft from the narrative and check it against the anchors
with `vestlang_verify_observations` instead.

If you happen to know the real grant total, pass it as the optional
`grant_quantity`. The tool still will not refuse — inference is unchanged — but it
adds a deterministic `diagnostics.coverage` tell (`{ grantQuantity, trancheSum,
delta, status }`) and, on a shortfall, a note: the arithmetic signal that the
tranche sum falls below the stated grant — which may mean the stream is only a partial slice.
It is a `partial` reading either way — a legitimately under-allocating schedule
sums below its grant too — so treat it as a prompt to check with
`vestlang_verify_observations`, not proof.

## Narrative vs. anchors

When you present the final DSL, separate what the anchors proved from what only the
narrative asserts. In the first example the cliff and the cadence are pinned by the
two tranches — 148,140 at the one-year mark is exactly twelve months of the monthly
rate, and 12,345 the following month confirms both the rate and the day-of-month
landing. Nothing observed, though, fixes the total duration past the second
tranche: the "four years" rests on the narrative alone. Say which is which. An
anchor-backed parameter is evidence a reader can check; a narrative-only one is an
assumption a reader can correct.
