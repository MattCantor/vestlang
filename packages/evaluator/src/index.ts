// Evaluation — the compiler's public API.
export {
  evaluateStatement,
  evaluateClauseGroups,
  evaluateProgram,
} from "./evaluate/index.js";
export {
  evaluateStatementAsOf,
  evaluateProgramAsOf,
  type VestedResult,
} from "./asof.js";

// Persistence / sidecar — no consumer today; its fate is an open Stage 5 decision.
export {
  rehydrate,
  reparseDefinition,
  type RehydrateResult,
  VESTLANG_SIDECAR_NAMESPACE,
  toSidecar,
  fromSidecar,
  toPersisted,
  rehydratePersisted,
  type Sidecar,
  type PersistedArtifact,
} from "./resolve/index.js";
