// The evaluator's public API — the orchestration entry points.
export {
  evaluateStatement,
  evaluateClauseGroups,
  evaluateProgram,
} from "./orchestrate.js";
export {
  resolveVestingStart,
  type ResolvedAnchor,
} from "./evaluate/resolveVestingStart.js";
export { evaluateProgramAsOf, type VestedResult } from "./asof.js";

// Allocation validity — the over/under-allocation rule, exposed for the persist
// layer so it can re-check a stored template (guarding rehydrate against an
// artifact that would over-vest) without re-resolving the program.
export { templateAllocationFindings } from "./resolve/index.js";

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
