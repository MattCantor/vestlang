// `@vestlang/core` — the reference compiler for the Open Cap Table Coalition
// aligned canonical
// interchange. The honest vestlang-blind surface: a resolved, combinator-free
// template plus a per-grant runtime become exact integer installments.
//
// The compiler surface only — structural/runtime validation, the template-space
// allocation diagnostics, and the compile entry points. The shared engine
// substrate it sits on (date math, the allocator, the grid kernel, the fold, the
// window analysis, the installment cap) lives in `@vestlang/primitives`; core
// deliberately does NOT re-export it.

export * from "./validate";
export * from "./findings";
export * from "./compile";
