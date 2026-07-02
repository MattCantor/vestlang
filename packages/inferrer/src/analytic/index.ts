// The analytic inferrer core. The inferrer fn + stats are the pluggable surface
// re-exported from the package root (the experiments sweep runner drives it); the
// solvers and candidate families are imported directly by the unit tests.

export { analyze, analyticInferrer, analyticStats } from "./driver.js";
export type { AnalyticInferrer, AnalyticStats } from "./driver.js";
