export { inferSchedule } from "./infer.js";
export { projectionResidual } from "./projection.js";
export { InferInputError } from "./errors.js";
// The analytic core's pluggable surface, read from the built dist by the
// knip-ignored experiments sweep runners (the same dist-import convention).
export { analyticInferrer, analyticStats } from "./analytic/index.js";
export type { AnalyticInferrer, AnalyticStats } from "./analytic/index.js";
export type {
  DecompositionComponent,
  HypothesisFamily,
  InferInput,
  InferResult,
  TrancheInput,
} from "./types.js";
