// `@vestlang/core` — the Carta-aligned canonical interchange engine.
//
// Exports the canonical IR types and structural/runtime validation, the engine
// primitives (the allocator, date math, and the anchor-date fold), and the
// compile entry points. Fraction arithmetic lives in `@vestlang/utils`.

export * from "./validate";
export * from "./allocate";
export * from "./dates";
export * from "./fold";
export * from "./compile";
