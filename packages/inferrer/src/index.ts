export { inferSchedule } from "./infer.js";
export { projectionResidual } from "./residual.js";
export { InferInputError } from "./errors.js";
// Stage-2b analytic core — a temporary public surface (2c finalizes what index
// exports). Re-exported so the knip-ignored experiments runners can import it
// from the built dist, the same dist-import convention the runners already use.
export { analyticInferrer, analyticStats } from "./analytic/index.js";
export type { AnalyticInferrer, AnalyticStats } from "./analytic/index.js";
export type {
  InferInput,
  InferResult,
  TrancheInput,
  Component,
  UniformComponent,
  SingleTrancheComponent,
  CliffUniformComponent,
} from "./types.js";
