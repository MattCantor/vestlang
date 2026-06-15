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
export { evaluateProgramAsOf, type VestedResult } from "./asof.js";

// Persistence / sidecar — consumed by @vestlang/pipeline (persist/rehydrate
// orchestration, behind the vestlang_persist / vestlang_rehydrate MCP tools)
// and by the MCP server's artifact-schema module.
export {
  isRehydrateDefinitionError,
  RehydrateDefinitionError,
  type RehydrateResult,
  VESTLANG_SIDECAR_NAMESPACE,
  fromSidecar,
  toPersisted,
  rehydratePersisted,
  type PersistedArtifact,
} from "./resolve/index.js";
