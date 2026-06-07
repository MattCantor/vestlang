// `@vestlang/utils` — dependency-free low-level primitives shared across the
// repo: exact-rational fraction arithmetic and the selector-keyword display
// helper. A leaf package so the authoring-time linter can share the engine's
// fraction math without an edge onto the evaluation engine (`@vestlang/core`).

export * from "./fractions.js";
export * from "./display.js";
