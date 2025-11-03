---
title: Overview
sidebar_position: 2
---
**Vestlang** is a domain-specific language (DSL) for expressing vesting schedules in a natural, human-readable form.

Example:

```vest
VEST 100 SCHEDULE OVER 4 years EVERY 1 month FROM LATER OF (EVENT ipo, DATE 2025-01-01)
```

This compiles into a **typed Abstract Syntax Tree (AST)**, then normalized into **Open Cap Table compatible vesting condition structures** used downstream.

---

## Core Design Goals

- **Readable:** Resembles real-world phrasing used in legal documents.
- **Composable:** Supports logical operators (`LATER OF`, `EARLIER OF`) for complex timing logic.
- **Type-Safe:** Every construct corresponds to a TypeScript type in `@vestlang/dsl`.
- **Normalizable:** Can be converted into standard vesting primitives for execution or analysis.


---

## Parsing Pipeline

| Stage | Source | Purpose |
|-------|--------|---------|
| **Grammar (Peggy)** | `packages/dsl/src/grammar/*.peggy` | Strongly typed output from parser |
| **AST Types** | `packages/dsl/src/types.ts` | Strongly typed output from the parser |
| **Normalizer Types** | `packages/normalizer/src/types/*.ts` | Intermediate representation compatible with Open Cap Table vesting model |
