// @vestlang/pipeline — the shared consumer front door. Both apps route through
// the run* orchestrators and present the results; everything between user input
// and the engine lives here, once.

export { parseToProgram, parseRaw } from "./parse.js";
export type { PipelineError, Result, Loc } from "./parse.js";

export { parseQuantity, validateDate } from "./validate.js";

export { runEvaluate, runAsOf, runVestedBetween } from "./run.js";
export type {
  GrantInput,
  AsOfView,
  WindowView,
  RecoveredView,
  ClauseBreakdown,
} from "./run.js";

// The schedule presentation helpers, derived here off an EvaluatedSchedule:
// `presentSchedule` (the four orthogonal reads) and `ScheduleView` (the
// serializable display shape) so apps type their rendering off the pipeline
// alone, without reaching into the evaluator or summary internals.
export { presentSchedule } from "./present.js";
export type { SchedulePresentation } from "./present.js";
export type { ScheduleView } from "./view.js";
export type { Summary } from "./summary.js";

// Finding semantics, surfaced so consumers gate and word allocation findings the
// same way the display path does: `errorFindings` is the shared validity rule (an
// error-severity finding makes a schedule invalid), `formatFinding` its one-canonical
// wording. persist reads both to refuse — and name — an over-allocating program.
export { errorFindings, formatFinding } from "./findings.js";
