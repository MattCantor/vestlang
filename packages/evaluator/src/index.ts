export { evaluateStatementAsOf, type VestedResult } from "./asof.js";
export { evaluateStatement, evaluateProgram } from "./evaluate/index.js";
export {
  rehydrate,
  reparseDefinition,
  type RehydrateResult,
} from "./resolve/index.js";
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
