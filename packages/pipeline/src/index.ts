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

// Re-exported so the apps can type their rendering off the pipeline alone,
// without taking a direct dependency on the evaluator / summary internals.
export type { ScheduleView } from "@vestlang/evaluator";
export type { Summary } from "./summary.js";
