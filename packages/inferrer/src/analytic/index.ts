// The analytic inferrer core. `analyze` is the single entry — `inferSchedule`
// delegates to it; the solvers and candidate families are imported directly by
// the unit tests.

export { analyze } from "./driver.js";
