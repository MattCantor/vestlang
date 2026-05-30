// `@vestlang/core` — the Carta-aligned canonical interchange engine.
//
// Phase 1 surface: the canonical IR types and structural/runtime validation.
// Phase 2 adds the engine primitives: fractions, the allocator, date math, and
// the anchor-date fold. The compile entry points arrive in Phase 3.

export * from "./types";
export * from "./validate";
export * from "./fractions";
export * from "./allocate";
export * from "./dates";
export * from "./fold";
