// Evaluation — the compiler's public API.
export {
  evaluateStatement,
  evaluateClauseGroups,
  evaluateProgram,
} from "./evaluate/index.js";
export {
  resolveVestingStart,
  type ResolvedAnchor,
} from "./evaluate/resolveVestingStart.js";
export {
  evaluateStatementAsOf,
  evaluateProgramAsOf,
  type VestedResult,
} from "./asof.js";

// Persistence / sidecar — no consumer today; its fate is an open Stage 5 decision.
export {
  rehydrate,
  reparseDefinition,
  RehydrateDefinitionError,
  isRehydrateDefinitionError,
  type RehydrateResult,
  type RehydrateDefinitionSource,
  VESTLANG_SIDECAR_NAMESPACE,
  toSidecar,
  fromSidecar,
  toPersisted,
  rehydratePersisted,
  type Sidecar,
  type PersistedArtifact,
} from "./resolve/index.js";
