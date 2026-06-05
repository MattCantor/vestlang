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
| **`events-only`** | It resolves to concrete dated amounts but *can't* be one template — e.g. two overlapping independent absolute starts, or an event-anchored cliff | The bare dated amounts the interchange always accepts, plus a `reason`. Facts preserved, intent reported honestly — never disguised as a template |
| **`unresolved`** | It can't be materialized yet — waiting on an unfired event | Amounts with symbolic/absent dates + `blockers` naming what's missing |
| **`impossible`** | A condition can never be satisfied — e.g. an event required `BEFORE` a date already in the past | Installments flagged `IMPOSSIBLE` + `blockers` naming the contradiction |

A program collapses to **one** verdict — `template`, `events-only`, `unresolved`, or
`impossible` — never a fan-out to N. The program-level `status` is the headline; each
installment also carries its own `state` of `RESOLVED`, `UNRESOLVED`, or `IMPOSSIBLE`.

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
| `@vestlang/inferrer` | — | The inverse: observed tranches → best-fit DSL (matching-pursuit) |
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
`evaluateProgram(program, ctx)`. The engine itself is reachable as `core`:

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

### Two overlapping absolute starts → `events-only`

Two independent absolute-date grids on one grant can't be a single canonical template, so
the program resolves to bare dated amounts with the reason — `vest evaluate --program`:

`0.5 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 12 months PLUS 0.5 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 12 months` over 100 shares:

| Amount | Date | State |
|---:|:---|:---|
| 50 | 2026-01-01 | RESOLVED |
| 50 | 2026-07-01 | RESOLVED |

`fidelity: events-only` — *"Two independent absolute-date vesting grids on one grant."*

### The inverse: tranches → DSL

`inferSchedule` reconstructs a best-fit vestlang program from an observed array of
`{ date, amount }` tranches via matching-pursuit decomposition (it peels off the
largest recognizable component — a uniform run, a cliff — then re-fits the remainder),
returning the `dsl`, the decomposition, and diagnostics (residual error, detected policies).

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
