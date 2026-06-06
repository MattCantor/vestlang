---
title: Introduction
slug: /
sidebar_position: 0
---

# Vestlang

**Vestlang is a domain-specific language for writing equity vesting schedules — including the contingent parts — and a canonical engine that resolves them into exact, integer-allocated installments.**

Most vesting is easy to write down: *4 years monthly, 1-year cliff.* The hard part is **contingency** — vesting that waits on an IPO, or starts at the *later of* a date and an event — which usually can't be written down at all until the event happens. Vestlang handles both halves:

- **A DSL** for expressing vesting intent, contingency included — combinators like `LATER OF` / `EARLIER OF`, event gates, and conditional starts. (A combinator is an operator over anchors: "the later of 12 months and `EVENT "ipo"`".)
- **A canonical engine** (`@vestlang/core`) that resolves that intent against runtime — the grant date, the share count, which events have fired — and allocates exact integer shares with no rounding drift.

The engine's template is a proposed **interchange**: a single, exact schedule format that different cap-table tools can produce and consume, deliberately shaped to track Carta's production cap-table schema. The DSL is where the contingency an interchange *can't* hold gets expressed, then resolved down to it.

```vest
VEST OVER 4 years EVERY 1 month CLIFF 1 year
```

Over 4,800 shares: 1,200 vest at the 1-year cliff, then 100/month for 36 months — 37 installments that telescope to exactly 4,800, the rounded shares summing to the grant with no drift.

## The fidelity ladder

Real intent doesn't always fit a clean template, and contingent intent can't always resolve yet. Rather than force-fit or fail, vestlang **classifies** every evaluated schedule into one of four `status` verdicts:

| `status` | When |
| :--- | :--- |
| **`template`** | Fits one canonical template — exact installments, structured round-trip, intent preserved. |
| **`events-only`** | Resolves to concrete dated amounts but can't be one template (e.g. an event-anchored cliff, or independent absolute starts that interleave into no single grid) — the bare dated amounts the interchange always accepts, plus the reason. |
| **`unresolved`** | Can't be materialized yet — waiting on an unfired event — reported with `blockers` naming what's missing. |
| **`impossible`** | A condition can never be satisfied — flagged with the contradiction. |

The verdict is the honesty: facts are preserved and intent is reported as it is, never disguised as a template it isn't. A whole multi-statement program collapses to **one** verdict, never a fan-out. See [Evaluation](./evaluation.md) for the full model.

`events-only` is a verdict about *authored structure*, though — and some events-only programs project a stream that *does* have a single-template form. The default program surfaces re-infer it and, when it reproduces the projection exactly, publish `template` with a `recovered` note: [template recovery](./evaluation.md#template-recovery).

## Background

A vesting model is really three layers: a **spec** (the schedule definition), a **compiler** (which resolves the spec against runtime), and a **projection** (the resulting stream of dated installments). OCF standardized the projection — a single `{date, amount}` installment — but its earlier templating attempt, a DAG of vesting conditions, saw little adoption. Vestlang explores a different shape: an AST-based spec plus an exact reference compiler, offered as a candidate interchange that cap-table tools could share.

## Explore

- **[Grammar](./dsl_grammar.md)** — the DSL surface: schedules, anchors, combinators, conditions, and `THEN` / `PLUS` composition.
- **[AST](./ast.md)** — what a statement compiles to.
- **[Evaluation](./evaluation.md)** — how intent resolves against runtime, the fidelity ladder, and the installment model.
- **[Playground](./playground.mdx)** — write a statement and watch it evaluate, live.

## Use it

- **As a library.** `npm install @vestlang/vestlang` for the full toolkit — parse, evaluate, lint, stringify, infer — or `@vestlang/core` for just the canonical engine. The engine ships dual CJS/ESM, so even CommonJS consumers can depend on it.
- **From an LLM agent.** The MCP server exposes the whole pipeline as Model Context Protocol tools and publishes the grammar, spec, and examples as resources — the surface for driving vestlang from an agent.
