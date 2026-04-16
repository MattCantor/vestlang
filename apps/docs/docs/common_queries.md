# Common Queries

Reference for LLM consumers of the vestlang MCP server. Lists the summary fields
attached to `vestlang_evaluate_as_of` output, window queries via
`vestlang_vested_between`, and the date-math primitives — so derived numbers come
from tool output rather than model arithmetic.

## Summary fields on `vestlang_evaluate_as_of`

Each statement's response includes a `summary` object:

| Field | Type | Meaning |
|---|---|---|
| `total_vested` | number | Sum of shares across all RESOLVED `vested` installments. |
| `total_unvested` | number | Sum of shares across `unvested` (RESOLVED + UNRESOLVED) plus the top-level `unresolved` quantity. |
| `total_impossible` | number | Sum of shares across `impossible`. |
| `percent_vested` | number | `total_vested / grant_quantity`, 0–1, rounded to 4 decimals. |
| `next_vest_date` | ISO date \| null | Earliest upcoming RESOLVED installment date in `unvested`. Null if no upcoming RESOLVED tranche. |
| `next_vest_amount` | number \| null | Amount of that upcoming tranche. |
| `fully_vested_date` | ISO date \| null | Latest installment date, but only if the schedule is fully determinate (`unresolved === 0`, no impossible, all unvested RESOLVED). Null when the endpoint is unknowable (e.g. gated on an event with no occurrence date). |
| `cliff_date` | ISO date \| null | Earliest date in `vested`. Null if nothing has vested yet. |

### Example

```
dsl: "VEST OVER 4 years EVERY 1 month CLIFF 1 year"
grant_date: 2025-01-01, grant_quantity: 100000, as_of: 2026-04-16
```

Returns (abbreviated):

```json
{
  "summary": {
    "total_vested": 31250,
    "total_unvested": 68750,
    "total_impossible": 0,
    "percent_vested": 0.3125,
    "next_vest_date": "2026-05-01",
    "next_vest_amount": 2083,
    "fully_vested_date": "2029-01-01",
    "cliff_date": "2026-01-01"
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
day-of-month clamping.

Example: `date=2025-01-31, length=1, unit=months, rule=31_OR_LAST_DAY_OF_MONTH`
→ `2025-02-28`.

### `vestlang_date_diff`

Whole calendar days or whole calendar months between two dates. For `months`,
also returns `remainder_days` (days from the anchor month-boundary to `to`).
Signed: if `to < from`, the diff is negative.

### `vestlang_resolve_offset`

Resolve a vestlang offset expression to a concrete date. Accepts anything
valid after `VEST FROM` in the DSL:

- `+3 months`
- `EVENT ipo + 6 months`
- `DATE 2025-01-01 - 2 days`
- `EARLIER OF (EVENT a, EVENT b)`

Missing events surface as an `unresolved` blocker rather than an error.

### `vestlang_resolve_vesting_day`

Apply a `vesting_day_of_month` rule to a date's year+month without crossing
months. Answers: "under rule X, what day does this month's tranche fall on?"

Example: `date=2026-02-15, rule=29_OR_LAST_DAY_OF_MONTH` → `2026-02-28`.
