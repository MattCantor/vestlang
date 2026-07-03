# Common Queries

Reference for LLM consumers of the vestlang MCP server. Lists the summary fields
attached to `vestlang_evaluate_as_of` output, window queries via
`vestlang_vested_between`, and the date-math primitives — so derived numbers come
from tool output rather than model arithmetic.

## Error responses

Every tool result is tagged with a top-level `ok` boolean — one envelope across
all tools. On success the result is `{ "ok": true, … }`; a **structured refusal**
(the tool ran fine and its answer is the refusal) comes back as:

```json
{ "ok": false, "error": { "ruleId": "syntax-error", "message": "…", "loc": { "start": { "line": 1, "column": 1 }, "end": { "line": 1, "column": 5 } } } }
```

Branch on `ok` — a false `ok` is data to read, not a thrown error. The `error`
object always carries a machine-readable `ruleId` and a human `message`; some
ruleIds carry extra typed fields (`loc`, `unresolved`). This shape is uniform
across every refusal-capable tool:

- **`vestlang_parse` / `vestlang_compile` / `vestlang_evaluate` /
  `vestlang_evaluate_as_of` / `vestlang_vested_between`** —
  `ruleId: "syntax-error"` when the DSL didn't parse (carries `loc`, the source
  span of the offending token), or `ruleId: "evaluation-error"` when it parsed
  but evaluation couldn't proceed (e.g. a schedule too large to materialize, or a
  `from` after `to` on a window query; no `loc` — not tied to a source position).
- **`vestlang_persist`** — `ruleId: "persist-not-storable"` when the program
  isn't storable as a single template (lint-error, over-allocation, or a
  non-template shape; the `message` names which).
- **`vestlang_rehydrate`** — `ruleId: "rehydrate-missing-grant-date"`,
  `"rehydrate-over-allocation"`, `"rehydrate-malformed-percentage"`,
  `"rehydrate-corrupt-definition"`, `"rehydrate-missing-start-marker"`,
  `"rehydrate-unexpected-start"`, or `"rehydrate-namespace-violation"` for a
  damaged or hand-built artifact.
- **`vestlang_resolve_offset`** — `ruleId: "offset-unresolved"` (carries
  `unresolved`, the blocking reason) when a referenced event hasn't fired, or
  `"offset-not-single-expression"` when the input isn't one offset expression.

### The `isError` boundary (exceptions, not refusals)

A structured refusal (`ok: false`) is distinct from MCP's `isError` flag.
`isError: true` marks a **genuine unstructured exception** — there is no `ruleId`
to expose and no `ok` on the result:

- a bad-input throw from `vestlang_stringify` (a malformed AST) or
  `vestlang_infer_schedule` (un-inferrable input);
- a date-math overflow past the representable range (`vestlang_add_period` /
  `vestlang_resolve_offset` on a huge offset);
- an input-schema (zod) rejection (e.g. a `grant_quantity` past
  `MAX_SAFE_INTEGER`, an impossible calendar date, or a `vestlang_infer_schedule`
  `tranches` array over the maximum entry count).

A robust consumer checks `isError` first (protocol/exception failure), then `ok`
(structured refusal vs. success).

Note `ok` is the envelope flag, separate from any domain field inside a success:
`vestlang_evaluate`'s `valid` (false ⇔ the schedule over-allocates) and
`vestlang_lint`'s `errorFree` (false ⇔ error-severity diagnostics) both live
inside an `{ ok: true, … }` result.

## Verdicts and flags on the `vestlang_evaluate` response

`vestlang_evaluate` evaluates the whole program as one schedule and returns two
verdicts plus a few derived reads (and a per-clause `breakdown`).
`vestlang_evaluate_as_of` partitions the same schedule by date and carries the
validity channel — `valid` and `findings`, the same `false`-when-over-allocating
verdict `vestlang_evaluate` reports — so the read tools agree with `evaluate`. (It
still doesn't expose the storability verdicts; for those use `vestlang_evaluate`.)
See [its summary fields](#summary-fields-on-vestlang_evaluate_as_of) below.
See [Evaluation](./evaluation.md) for the full model; the short version:

| Field | Type | Meaning |
|---|---|---|
| `storable` | `{ status, reason? }` | What a record keeper could hold, asked without reading firings. `status` ∈ `template` / `events-only` / `unrepresentable` / `impossible`. |
| `resolvesTo` | `{ status, reason? }` | What it works out to given the events you passed. `status` ∈ `template` / `events-only` / `unresolved` / `impossible`. |
| `representable` | boolean | From `storable` — can it be stored at all. |
| `pending` | boolean | From `blockers` — witnesses (unfired events) still missing. A `template` can be `pending`; read pending here, never from a `status`. |
| `valid` | boolean | `false` when the schedule allocates more than the grant (see `findings`). |
| `findings` | array | Schedule advisories — allocation problems, precision warnings, and event-id case near-misses — each with `kind`, `severity`, and a human `message` (allocation kinds also carry an exact `sum`). |
| `absenceAssumptions` | array | Events the resolves-to reading is assuming stayed absent — each `{ eventId, through, direction, inclusive, consequence, message }`. Direction-aware: `direction` (`"before"`/`"after"`) and `inclusive` say which side of `through` a dangerous firing of `eventId` falls on, so the `message` reads "did not occur before/after `through`" (a `BEFORE`/EARLIER OF watch names the before side, an `AFTER`/LATER OF the after side). `consequence` says how much that firing changes: `"flips-to-impossible"` (a gate the grant can no longer satisfy — a dead grant) or `"grid-shift"` (a selector re-anchoring — the schedule just moves). A later/backdated firing on that side could change the result. Empty for a date-only or fully-fired schedule. |
| `installments` | array | The dated projection (RESOLVED), or symbolic tranches when something is pending. |
| `blockers` | array | What's unfired/contradictory, structurally. |
| `breakdown` | array | Per-clause attribution — one entry per statement (a THEN chain is one entry, since its segments can't be placed apart), each with its own `installments` and `blockers` (no verdict; a clause has no storable schedule of its own). The per-clause amounts are a partition of the one headline allocation, so they **sum to the headline by construction** (each clause adopts the headline's odd-share placement — `1/3 PLUS 1/3 PLUS 1/3` of 100 reads 33/33/34). When `valid` is false the headline itself over-allocates; the breakdown still sums to that total — the warning is the over-allocation `findings` entry. |

## Summary fields on `vestlang_evaluate_as_of`

`vestlang_evaluate_as_of` partitions the evaluated installments by the as-of date — into `vested` (RESOLVED on/before `as_of`) and `unvested` (RESOLVED after `as_of`, plus UNRESOLVED), alongside the `unresolved` quantity and `impossible` installments. The summary fields derive from those buckets. (The library's `EvaluatedSchedule` carries the two verdicts, `absenceAssumptions`, the flat `installments`, and `blockers`; the as-of partitioning and `summary` are what the MCP layer adds on top.)

The response includes `valid` and `findings` (the validity channel — see the rows
below) alongside a `summary` object:

| Field | Type | Meaning |
|---|---|---|
| `valid` | boolean | `false` when the program allocates more than the grant (an error-severity finding). The partition and summary are still returned — annotate, don't certify. |
| `findings` | array | Schedule advisories — allocation problems, precision warnings, and event-id case near-misses — each with `kind`, `severity`, and a human `message` (the same shape `vestlang_evaluate` returns; allocation kinds also carry an exact `sum`). Empty for a valid program with nothing to flag. |
| `total_vested` | number | Sum of shares across all RESOLVED `vested` installments. |
| `total_unvested` | number | Sum of shares across `unvested` (RESOLVED + UNRESOLVED) plus the top-level `unresolved` quantity. |
| `total_impossible` | number | Sum of shares across `impossible`. |
| `percent_vested` | number | `total_vested / grant_quantity`, rounded to 4 decimals. Usually 0–1, but **not clamped**: an over-allocating schedule (`valid: false`) reads above 1 — e.g. `1.2` when 120% has vested. It is deliberately decoupled from being ≤ 1 in the invalid case; the verdict is carried by `valid`/`findings`. |
| `next_vest_date` | ISO date \| null | Earliest upcoming RESOLVED installment date in `unvested`. Null if no upcoming RESOLVED tranche. |
| `next_vest_amount` | number \| null | Amount of that upcoming tranche. |
| `fully_vested_date` | ISO date \| null | Latest installment date, but only if the schedule is fully determinate (`unresolved === 0`, no impossible, all unvested RESOLVED). Null when the endpoint is unknowable (e.g. gated on an event with no occurrence date), and null when `valid` is false — it would otherwise assert a false "fully vested" completion for an over-allocating grant. |

### Example

```
dsl: "VEST OVER 4 years EVERY 1 month CLIFF 1 year"
grant_date: 2025-01-01, grant_quantity: 100000, as_of: 2026-04-16
```

Returns (abbreviated):

```json
{
  "valid": true,
  "findings": [],
  "summary": {
    "total_vested": 31250,
    "total_unvested": 68750,
    "total_impossible": 0,
    "percent_vested": 0.3125,
    "next_vest_date": "2026-05-01",
    "next_vest_amount": 2083,
    "fully_vested_date": "2029-01-01"
  }
}
```

## Window queries: `vestlang_vested_between`

Use for "how much vested in window X?". Bounds are inclusive. Only RESOLVED
installments within `[from, to]` are counted — UNRESOLVED and IMPOSSIBLE
installments have not vested by definition.

```
from: 2025-07-01, to: 2025-12-31  →  tranches_in_window + vested_in_window
```

## Date-math tools

Use these instead of doing date arithmetic in prose. They route through the
same evaluator that drives real vesting, so day-of-month rules, leap-year
handling, and month-end semantics are identical.

### `vestlang_add_period`

`date + (length × unit)`. Units: `days`, `weeks`, `months`, `years`. Negative
`length` subtracts. For months/years the `vesting_day_of_month` rule controls
the resulting day-of-month.

Month arithmetic clamps at month-ends, so it is neither invertible nor
associative: `2025-01-31 + 3 months → 2025-04-30` (April has no 31st), but
`2025-04-30 − 3 months → 2025-01-30`, not back to the 31st — the lost day-of-31
can't be recovered. And `(2025-01-31 + 1 month) + 1 month → 2025-03-28` while
`2025-01-31 + 2 months → 2025-03-31`. Don't compose period additions step by
step when you mean a single span.

Example: `date=2025-01-31, length=1, unit=months, rule=LAST_DAY_OF_MONTH`
→ `2025-02-28`.

### `vestlang_date_diff`

Whole calendar days or whole calendar months between two dates. For `months`,
also returns `remainder_days` (days from the anchor month-boundary to `to`).
Signed: if `to < from`, the diff is negative.

### `vestlang_resolve_offset`

Resolve a vestlang offset expression to a concrete date. Accepts anything
valid after `VEST FROM` in the DSL:

- `+3 months`
- `+20 days +1 month` (multi-term bare offset, aggregated months-first off the grant date)
- `EVENT ipo + 6 months`
- `DATE 2025-01-01 - 2 days`
- `EARLIER OF (EVENT a, EVENT b)`

When the expression can't resolve — a referenced event hasn't fired — the call
returns `{ ok: false, error: { ruleId: "offset-unresolved", … } }` whose
`unresolved` field names the blocking reason.

### `vestlang_resolve_vesting_day`

Apply a `vesting_day_of_month` rule to a date's year+month without crossing
months. Answers: "under rule X, what day does this month's tranche fall on?"

The rule is one of the four `OCFVestingDayOfMonthPolicy` values — `VESTING_START_DAY`
(the default; track the start's own day, clamped down on short months),
`FIRST_DAY_OF_MONTH`, `LAST_DAY_OF_MONTH`, or `VESTING_START_DAY_MINUS_ONE`. There
are no numeric day-of-month values, and no `29`/`30` clamping policies — a month-end
result comes from `LAST_DAY_OF_MONTH` or from `VESTING_START_DAY` clamping a late
start day down to the month's last day.

Example: `date=2026-02-15, rule=LAST_DAY_OF_MONTH` → `2026-02-28`.
