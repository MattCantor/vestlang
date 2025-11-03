---
title: Welcome
slug: /
sidebar_position: 0
---

**Vestlang** is a domain-specific language (DSL) for expressing vesting schedules in a natural, human-readable form.

Example:

```vest
VEST OVER 4 years EVERY 1 MONTH CLIFF 12 MONTHS
```

This compiles into a **typed Abstract Syntax Tree (AST)**, and is then normalized into **Open Cap Table** compatible `vesting` objects, with additional metadata.

---

## Core Design Goals

- **Readable:** Resembles real-world phrasing used in legal documents.
- **Composable:** Supports logical operators (`LATER OF`, `EARLIER OF`, `BEFORE`, `AFTER`, `AND`, `OR`) for complex timing logic.
- **Type-Safe:** Every construct corresponds to a TypeScript type in `@vestlang/types`.
- **Normalizable:** Can be converted into standard vesting primitives for execution or analysis.

## Motivation

The motivation for this project is the facilitate a discussion within the Open Cap Table project regarding templating for vesting schedules, as discussed in further detail [here](./01-Motivation.md).
