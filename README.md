# Vestlang

> **A domain-specific language for modeling equity vesting schedules — and a canonical engine that resolves them exactly.**

[Documentation](https://mattcantor.github.io/vestlang/)

---

Every cap-table system models vesting a little differently, and the hardest part — the
*contingent* bits, like vesting that waits on an IPO or starts at the *later of* a date and
an event — usually can't be written down at all until the event happens. Vestlang tackles
both halves:

- **A DSL** for *writing* vesting intent, contingency included — **combinators** like
  `LATER OF` / `EARLIER OF`, event gates, and conditional starts (a combinator is an
  operator over anchors, e.g. "the later of 12 months and `EVENT "ipo"`").
- **A canonical engine** (`@vestlang/core`) that *resolves* that intent against runtime
  (the grant date, share count, which events have fired) and allocates exact integer shares.

The engine's template is a proposed **interchange** — a single, exact schedule format that
different cap-table tools can produce and consume, deliberately shaped to track Carta's
production cap-table schema. The DSL is where the contingency that an interchange *can't*
hold gets expressed and then resolved down to it.

```ts
import { parse, normalizeProgram, evaluateStatement } from "@vestlang/vestlang";

const program = normalizeProgram(parse("VEST OVER 4 years EVERY 1 month CLIFF 1 year"));
const schedule = evaluateStatement(program[0], {
  events: { grantDate: "2025-01-01" },
  grantQuantity: 4800,
  asOf: "2026-04-16",
});
// → 1,200 shares vest at the 1-year cliff (2026-01-01), then 100/month for 36 months.
//   37 installments that telescope exactly to 4,800 (the rounded shares sum to the
//   grant with no drift).
```

---

## How it works

The pipeline turns a DSL string into a classified, exactly-allocated schedule:

```
DSL string ──parse──▶ raw AST ──normalizeProgram──▶ Program (rich AST)
                                   │
                 resolve combinators vs. runtime, then CLASSIFY
                                   ▼
                          EvaluatedSchedule, status ∈
                            template     — fits one canonical template
                            events-only  — dated facts, not one template (+ reason)
                            unresolved   — waiting on an unfired event
                            impossible   — a contradiction; can never resolve
```

### Two layers: *resolve* vs. *substitute*

The codebase splits along one precise line:

- **The engine (`@vestlang/core`) *substitutes*.** Given a fixed, combinator-free template
  + runtime + share count, it plugs in the values and allocates exactly — deterministically,
  one template + runtime → one installment set. It never sees a combinator, a symbolic date,
  or an "unresolved" state. This is the canonical interchange: exact-rational math, a
  time-based cliff, structural validation.
- **The front-end (`@vestlang/evaluator`, the "extended" layer) *resolves*.** Combinators
  let runtime *select the structure itself* — `LATER OF(12mo, EVENT "ipo")` becomes a
  different schedule depending on which date wins. The resolver evaluates that against
  runtime and then **classifies** the result into one of four `status` verdicts.

Think of it like a source language and an IR: the DSL expresses *contingency and intent*
that the resolved interchange can't *hold*; the engine is the exact, validated target that
multiple producers can share.

### The fidelity ladder

Every evaluated program lands on exactly one `status`:

| `status` | When | What you get |
|---|---|---|
| **`template`** | The program fits one canonical template | Exact installments; structured round-trip; intent preserved (best case) |
| **`events-only`** | It resolves to concrete dated amounts that *can't* be one template — e.g. an event-anchored cliff, or independent absolute starts that interleave into no single grid | The bare dated amounts the interchange always accepts, plus a `reason`. Facts preserved, intent reported honestly — never disguised as a template |
| **`unresolved`** | It can't be materialized yet — waiting on an unfired event | Amounts with symbolic/absent dates + `blockers` naming what's missing |
| **`impossible`** | A condition can never be satisfied — e.g. an event required `BEFORE` a date already in the past | Installments flagged `IMPOSSIBLE` + `blockers` naming the contradiction |

A program collapses to **one** verdict — `template`, `events-only`, `unresolved`, or
`impossible` — never a fan-out to N. The program-level `status` is the headline; each
installment also carries its own `state` of `RESOLVED`, `UNRESOLVED`, or `IMPOSSIBLE`.

**Template recovery.** `events-only` is a verdict about *authored structure*, not the
realized numbers — and some events-only programs project a stream that *does* have a
single-template form (two overlapping absolute-date grids that are really one cadence, say).
The default program-evaluation surfaces — `evaluateProgramWithRecovery`, the MCP
`vestlang_evaluate_program` tool, and `vest evaluate --program` — re-infer that template and,
when it reproduces the projection exactly, publish `template` with a `recovered` note, turning
a lossy `events-only` back into a clean canonical form. The rescue is sound only for
firing-invariant programs (no event anchors), so contingent schedules are never collapsed; the
raw classifier (`evaluateProgram`) still reports the structural verdict.

---

## Packages

Two packages are **published**; the rest are internal building blocks, inlined into the
umbrella at build time and never published on their own.

| Package | Published | Role |
|---|:---:|---|
| **`@vestlang/vestlang`** | ✅ | The umbrella toolkit — parse, normalize, evaluate, lint, stringify, infer. The package you install. |
| **`@vestlang/core`** | ✅ | The standalone canonical engine (dual CJS/ESM): exact-rational allocator, time-based cliff, structural + runtime validation. Consumable on its own. |
| `@vestlang/dsl` | — | PEG grammar + parser |
| `@vestlang/normalizer` | — | Raw AST → normalized canonical AST |
| `@vestlang/evaluator` | — | The resolver/classifier (the "extended" layer) |
| `@vestlang/inferrer` | — | The inverse: observed tranches → best-fit DSL (branch-and-bound exact cover) |
| `@vestlang/recover` | — | Template recovery: composes evaluator + inferrer to rescue an `events-only` program into a template when its projection has one |
| `@vestlang/linter` · `@vestlang/stringify` · `@vestlang/types` | — | Diagnostics · DSL rendering · shared types |

Apps (private): `apps/cli`, `apps/mcp-server`, `apps/docs`.

> The umbrella is published as `@vestlang/vestlang` today; the unscoped `vestlang` name is
> the intended target (pending a registry clearance).

---

## Using it

### 1. As a library

```bash
npm install @vestlang/vestlang      # or: pnpm add @vestlang/vestlang
```

```ts
import { parse, normalizeProgram, evaluateStatement } from "@vestlang/vestlang";

const program = normalizeProgram(parse('VEST OVER 4 years EVERY 1 month CLIFF 1 year'));
const schedule = evaluateStatement(program[0], {
  events: { grantDate: "2025-01-01" },     // grantDate is required
  grantQuantity: 4800,
  asOf: "2026-04-16",                       // the scenario date (required)
  // optional: vesting_day_of_month
});

schedule.status;        // "template" | "events-only" | "unresolved" | "impossible"
schedule.installments;  // [{ amount, date, meta: { state } }, ...]
schedule.blockers;      // [] unless something is unresolved or impossible
```

`evaluateStatement` classifies one statement at a time. To collapse a whole multi-statement
program into a **single** schedule and read its program-level fidelity verdict, use
`evaluateProgramWithRecovery(program, ctx)` — the default, which also recovers an `events-only`
program into a template when its projection has one — or `evaluateProgram(program, ctx)` for the
raw classifier verdict. The engine itself is reachable as `core`:

```ts
import { core } from "@vestlang/vestlang"; // or: import * as core from "@vestlang/core"
```

Reach for `@vestlang/core` directly when you already hold a resolved, combinator-free
template — e.g. another cap-table tool consuming the interchange — and just need exact
allocation, skipping the DSL entirely. It ships dual CJS/ESM (the rest of the toolkit is
ESM-only) so even CommonJS consumers can depend on the engine.

### 2. As an MCP server

`apps/mcp-server` exposes the full pipeline as Model Context Protocol tools —
`vestlang_parse`, `vestlang_compile`, `vestlang_evaluate`, `vestlang_evaluate_program`,
`vestlang_evaluate_as_of`, `vestlang_lint`, `vestlang_stringify`, `vestlang_infer_schedule` —
and publishes the grammar/spec/examples as resources. This is the surface for driving
vestlang from an LLM agent.

---

## Examples

All grants below use a grant date of **2025-01-01**. Outputs are produced by the engine.

### Time-based vesting with a cliff → `template`

`VEST OVER 4 years EVERY 1 month CLIFF 1 year` over 4,800 shares:

| Amount | Date | State |
|---:|:---|:---|
| 1,200 | 2026-01-01 | RESOLVED *(cliff lump)* |
| 100 | 2026-02-01 | RESOLVED |
| … | … *(34 more)* | … |
| 100 | 2029-01-01 | RESOLVED |

37 installments, telescoping to exactly 4,800.

### Event-gated cliff → `template` when fired, `unresolved` when not

`VEST OVER 4 years EVERY 1 month CLIFF LATER OF(+12 months, EVENT ipo)` over 4,800 shares.
The cliff is the *later* of 12 months and the IPO.

**IPO fired on 2026-06-15** → the cliff lands there; everything before it lumps:

| Amount | Date | State |
|---:|:---|:---|
| 1,700 | 2026-06-15 | RESOLVED *(cliff lump)* |
| 100 | 2026-07-01 | RESOLVED |
| … | … | … |

**IPO not yet fired** → the +12-month floor is only a *lower bound* (the IPO can only push
the cliff later), so nothing is asserted as vested:

| Amount | Symbolic date | State | Unresolved |
|---:|:---|:---|:---|
| 1,200 | `{ UNRESOLVED_CLIFF, 2026-01-01 }` | UNRESOLVED | `EVENT ipo` |
| 100 | `{ UNRESOLVED_CLIFF, 2026-02-01 }` | UNRESOLVED | `EVENT ipo` |
| … | … | … | … |

…with a blocker: `{ type: "EVENT_NOT_YET_OCCURRED", event: "ipo" }`. Supply the event —
`events: { ipo: "2026-06-15" }` (or set `asOf` to model a scenario) — and the same schedule
resolves to the table above. That "schedule known, runtime not yet" span is the default
state of equity, and the DSL owns all of it.

### Graded, multi-statement → one `template`

A 5 / 15 / 40 / 40 graded schedule, written as four statements, collapses to a single
template (no fan-out) — `vest evaluate --program`, 100 shares:

| Amount | Date | State |
|---:|:---|:---|
| 5 | 2026-01-01 | RESOLVED |
| 15 | 2027-01-01 | RESOLVED |
| 40 | 2028-01-01 | RESOLVED |
| 40 | 2029-01-01 | RESOLVED |

`fidelity: template`.

### Two overlapping absolute starts → recovered to `template`

Two independent absolute-date grids classify `events-only` on structure alone — but their
realized projection can still have a single-template form, and the default program surfaces
recover it. `0.5 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 12 months PLUS 0.5 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 12 months` over 100 shares — `vest evaluate --program`:

| Amount | Date | State |
|---:|:---|:---|
| 50 | 2026-01-01 | RESOLVED |
| 50 | 2026-07-01 | RESOLVED |

`status: template` — **recovered** from `events-only`, because the two grids are really one
6-month cadence: `100 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 6 months`. The raw
classifier (`evaluateProgram`) still reports `events-only`; recovery is a property of the
default program surfaces and only fires when the inferred template reproduces the projection
exactly.

### Genuinely `events-only` (no recovery)

When the grids interleave into a stream with no single-template form, recovery correctly
declines and the verdict stays `events-only`. Two monthly grids on different days of the
month — the 1st and the 15th — `0.5 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month PLUS 0.5 VEST FROM DATE 2024-01-15 OVER 4 months EVERY 1 month`:

| Amount | Date | State |
|---:|:---|:---|
| 100 | 2024-02-01 | RESOLVED |
| 100 | 2024-02-15 | RESOLVED |
| … | … *(6 more, alternating)* | … |

`status: events-only` — *"Two independent absolute-date vesting grids on one grant."* (An
event-anchored cliff, `CLIFF EVENT ipo`, is the other genuine case — a cliff with no fixed
date has no template form.)

### The inverse: tranches → DSL

`inferSchedule` reconstructs a best-fit vestlang program from an observed array of
`{ date, amount }` tranches by **branch-and-bound minimum-cardinality exact cover**:
it covers the stream with the fewest components — uniform trains, cliffs, one-off
pulses. A greedy pass (take the largest fitting component, subtract, repeat) seeds an
upper bound, then the search tries to beat it. It returns the `dsl`, the decomposition,
and diagnostics (residual error, detected policies).

It recovers more than parallel components. When the tranches read as **one schedule
whose rate or cadence changes over time** — back-to-back segments on a continuing grid,
each picking up where the last left off — the inferrer emits a single `THEN` chain
rather than a stack of independent dated grids. So a stream like `100, 100, 200, 200, 100, 100`
(a monthly rate that doubles for two months, then returns) comes back as one schedule
that classifies as `template`, not as overlapping grids stuck at `events-only`. The chain
form also leaves the month-end handoffs to the engine, so a rate change that lands on a
short month (the 31st springing back to Feb 28/29) still stitches into one template.

This inverse is the engine behind **template recovery** above: when an `events-only` program
projects a stream the inferrer can re-cover as one template, the default program surfaces feed
the projection back through `inferSchedule` and re-classify the result.

---

## Development

```bash
pnpm install
pnpm build      # turbo build across all packages
pnpm test       # turbo test
```

This is a pnpm + turbo monorepo. `@vestlang/core` builds with `tsup` (dual CJS/ESM);
the rest build with `tsc`. Releases run through Changesets.

## License

MIT
