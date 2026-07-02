// Stage-2b analytic core. The inferrer fn + stats are the pluggable surface the
// experiments sweep runner drives (re-exported again from the package root). The
// solver internals and the candidate generator the unit/property tests pin are
// imported straight from their own modules.

export { analyticInferrer, analyticStats } from "./driver.js";
export type { AnalyticInferrer, AnalyticStats } from "./driver.js";
