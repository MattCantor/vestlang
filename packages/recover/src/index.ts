// @vestlang/recover
//
// A second opinion on the classifier's events-only fallback. When a program
// resolves to events-only only because its authored structure isn't a single
// canonical template — yet its realized projection has an equivalent one — this
// re-infers that template and, if it's verdict-equivalent, publishes it. Sits
// above the evaluator and the inferrer (it needs both, plus the evaluator again
// to re-classify), which is why it's its own package rather than living in either.

export { evaluateProgramWithRecovery } from "./recover.js";
export { hasEventBase } from "./gate.js";
export type { RecoveryOutcome, RecoveredTemplate } from "./types.js";
