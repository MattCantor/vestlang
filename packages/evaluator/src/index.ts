export {
  evaluateStatementAsOf,
  evaluateStatementsAsOf,
  type VestedResult,
} from "./asof.js";
export {
  evaluateStatement,
  evaluateStatements,
  evaluateProgram,
} from "./evaluate/index.js";
export { presentSchedule, type SchedulePresentation } from "./present.js";
export { toScheduleView, type ScheduleView } from "./view.js";
export { formatFinding } from "./findings.js";
export {
  rehydrate,
  reparseDefinition,
  type RehydrateResult,
} from "./resolve/index.js";
// The pre-assemble verdict and the assemble step, exposed for @vestlang/recover:
// it needs to inspect the structured ResolveResult (reason kind, the events-arm
// installments) before assemble flattens the reason to a string, then assemble a
// result it already holds without re-resolving. Most callers should stick to
// evaluateStatement/evaluateProgram above.
export { resolveToCore } from "./resolve/index.js";
export { assemble } from "./resolve/assemble.js";
export type { ResolveResult, NonTemplateReason } from "./resolve/index.js";
export {
  VESTLANG_SIDECAR_NAMESPACE,
  toSidecar,
  fromSidecar,
  toPersisted,
  rehydratePersisted,
  type Sidecar,
  type PersistedArtifact,
} from "./resolve/index.js";
export {
  addMonthsRule,
  addDays,
  toDate,
  toISO,
  lt,
  gt,
  eq,
} from "./evaluate/time.js";
