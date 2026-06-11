export {
  evaluateStatementAsOf,
  evaluateProgramAsOf,
  type VestedResult,
} from "./asof.js";
export {
  evaluateStatement,
  evaluateClauseGroups,
  evaluateProgram,
} from "./evaluate/index.js";
export { presentSchedule, type SchedulePresentation } from "./present.js";
export { toScheduleView, reasonToString, type ScheduleView } from "./view.js";
export {
  rehydrate,
  reparseDefinition,
  type RehydrateResult,
} from "./resolve/index.js";
// The pre-assemble verdict and the assemble step, exposed for @vestlang/recover:
// it inspects the events-arm installments on the structured ResolveResult to feed
// the inferrer, then assembles a result it already holds without re-resolving.
// (The reason it gates on now travels structured all the way onto the published
// EvaluatedSchedule, so recover reads it from there, not from here.)
// `resolveInterchange` gives it the firing-invariant verdict to pass alongside.
// Most callers should stick to evaluateStatement/evaluateProgram above.
export { resolveToCore, resolveInterchange } from "./resolve/index.js";
export { assemble } from "./resolve/assemble.js";
export type { ResolveResult } from "./resolve/index.js";
export {
  VESTLANG_SIDECAR_NAMESPACE,
  toSidecar,
  fromSidecar,
  toPersisted,
  rehydratePersisted,
  type Sidecar,
  type PersistedArtifact,
} from "./resolve/index.js";
