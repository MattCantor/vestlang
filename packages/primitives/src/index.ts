// `@vestlang/primitives` — the shared engine substrate both the reference
// compiler (`@vestlang/core`) and the resolution side (`@vestlang/evaluator`) sit
// on: policy-aware date math (incl. satisfiesRelation), the exact-integer
// allocator, the grid kernel, the anchor-date fold, the static empty-window
// analyses (date windows and same-anchor gates), and the installment cap. Pure
// substrate — no compiler, no resolution.
// Fraction arithmetic and the contingent-start sentinel live in `@vestlang/utils`.

export * from "./dates.js";
export * from "./allocate.js";
export * from "./fold.js";
export * from "./kernel.js";
export * from "./grid.js";
export * from "./window.js";
export * from "./same-anchor.js";
export * from "./limits.js";
export * from "./canonical-schema.js";
