// `@vestlang/utils` — dependency-free low-level primitives shared across the
// repo: exact-rational fraction arithmetic, the selector-keyword display
// helper, calendar-date validation, and the `assertNever` exhaustiveness guard.
// A leaf package so the authoring-time linter and the input boundaries can share
// the engine's primitives without an edge onto the evaluation engine
// (`@vestlang/core`).

export * from "./fractions.js";
export * from "./display.js";
export * from "./dates.js";
export * from "./assert.js";
