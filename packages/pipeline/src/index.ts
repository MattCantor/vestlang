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

// The persistence lifecycle orchestrators: persist a program to a storable
// artifact, rehydrate it against the world's firings, and resolve an offset
// expression to a date. All three route context construction through the internal
// `buildContext` (kept unexported, Option B), so the app can't hand-build a context
// and forget a piece.
export { runPersist, runRehydrate } from "./persist.js";
export type {
  PersistInput,
  PersistResult,
  RehydrateInput,
  RehydrateResult,
  RehydrateOutput,
  FiringToApply,
} from "./persist.js";
export { runResolveOffset } from "./resolve-offset.js";
export type {
  ResolveOffsetInput,
  ResolveOffsetResult,
} from "./resolve-offset.js";
