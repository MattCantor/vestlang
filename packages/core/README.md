# @vestlang/core

The reference compiler for the vestlang **canonical interchange** — the
Open Cap Table Coalition aligned schema for expressing a vesting schedule as
storable data.

Given a canonical schedule template and its runtime inputs (start anchor, share
count, fired events), core compiles it, validates its structure, and reports
template-space diagnostics. It is the piece that makes a canonical template
_interoperable_: without an agreed compiler, two systems reading the same
template can disagree on rounding, day-of-month, cliff, and re-anchoring.

```bash
npm install @vestlang/core
```

Ships both ESM and CommonJS, so it works under `import` and `require` alike.

## Looking for the DSL?

Most users want [`@vestlang/vestlang`](https://www.npmjs.com/package/@vestlang/vestlang) —
the batteries-included entry point. It layers the vesting DSL (combinators like
`LATER OF` / `EARLIER OF`, event gates, contingent starts) and the evaluator on
top of this compiler, and re-exports core as `core`. Reach for `@vestlang/core`
directly when you only need the canonical compiler, without the DSL front-end.

## License

MIT
