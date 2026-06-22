// `@vestlang/primitives` — the shared engine substrate both the reference
// compiler (`@vestlang/core`) and the resolution side (`@vestlang/evaluator`) sit
// on: policy-aware date math (incl. CONTINGENT_START_SENTINEL and
// satisfiesRelation), the exact-integer allocator, the grid kernel, the
// anchor-date fold, the static empty-window analysis, and the installment cap.
// Pure substrate — no compiler, no resolution. Fraction arithmetic lives in
// `@vestlang/utils`.

export * from "./dates.js";
export * from "./allocate.js";
export * from "./fold.js";
export * from "./kernel.js";
export * from "./window.js";
export * from "./limits.js";
