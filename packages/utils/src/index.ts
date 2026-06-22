// `@vestlang/utils` — the repo's lowest leaf: dependency-free low-level helpers
// shared everywhere — exact-rational fraction arithmetic, the over/under-
// allocation findings rule, the decimal-percentage precision analyzer, the
// selector-keyword display helper, calendar-date validation, and the
// `assertNever` exhaustiveness guard. Sits below even the engine substrate
// (`@vestlang/primitives`), so the authoring-time linter and the input
// boundaries can share these without an edge onto the compiler or evaluator.

export * from "./fractions.js";
export * from "./findings.js";
export * from "./precision.js";
export * from "./display.js";
export * from "./dates.js";
export * from "./assert.js";
export * from "./stable-key.js";
