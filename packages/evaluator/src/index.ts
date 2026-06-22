// The evaluator's public API — the orchestration entry points.
export {
  evaluateStatement,
  evaluateClauseGroups,
  evaluateProgram,
} from "./evaluate.js";
export {
  resolveVestingStart,
  type ResolvedAnchor,
} from "./interpret/resolveVestingStart.js";
export { evaluateProgramAsOf, type VestedResult } from "./asof.js";

// Persistence / sidecar — consumed by @vestlang/pipeline (persist/rehydrate
// orchestration, behind the vestlang_persist / vestlang_rehydrate MCP tools)
// and by the MCP server's artifact-schema module.
export {
  isRehydrateDefinitionError,
  RehydrateDefinitionError,
  isRehydrateMissingStartMarkerError,
  RehydrateMissingStartMarkerError,
  isSyntheticNamespaceError,
  SyntheticNamespaceError,
  type RehydrateResult,
  VESTLANG_SIDECAR_NAMESPACE,
  fromSidecar,
  toPersisted,
  rehydratePersisted,
  type PersistedArtifact,
} from "./resolve/index.js";
