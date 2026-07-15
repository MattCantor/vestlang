// The pipeline's one error shape, and the two ways into the parser.
//
// Every failure a consumer can hit — a syntax error in the DSL, or the engine
// throwing partway through evaluation — comes back as a `PipelineError`, so the
// CLI and the MCP server each map failures to their own output (a stderr line, a
// JSON `{ error }`) in exactly one place.

import { parse, toParseError } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type { Program, RawProgram } from "@vestlang/types";

export type Loc = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

// The two error vocabularies every orchestrator in the package shares. Both are
// discriminated on `ruleId`; a location only makes sense for a syntax error (it
// points at a span of source), so `loc` lives only in that arm — nothing else can
// accidentally carry one.
//
// `PipelineError` is a single closed union, so a reader can be exhaustive over
// every refusal the package emits. To keep that union readable as it grows we
// build it from per-orchestrator sub-unions below; those stay module-private so
// the public surface is just the one composed type.

// Parse and evaluate failures, raised from the shared parse/evaluate helpers and
// reused by every orchestrator that parses DSL or runs the engine.
type SharedError =
  | { ruleId: "syntax-error"; message: string; loc?: Loc }
  | { ruleId: "evaluation-error"; message: string };

// persist's refusals all mean "fix the schedule before it can be stored", so they
// share one umbrella ruleId; each site is told apart by its message.
type PersistError = { ruleId: "persist-not-storable"; message: string };

// rehydrate's damage modes a consumer might remediate differently: a hand-built
// artifact missing its grant date, one whose template over-allocates the grant,
// one whose stored start recipe no longer parses, one carrying the contingent-start
// sentinel with no `evt:start` recipe to re-derive it, the mirror case (an
// `evt:start` recipe paired with a non-sentinel startDate, which would otherwise
// silently overwrite a genuine stored start), or one whose sidecar key falls outside
// the reserved synthetic namespace (a tampered key aliasing a real user event).
type RehydrateError =
  | { ruleId: "rehydrate-missing-grant-date"; message: string }
  | { ruleId: "rehydrate-over-allocation"; message: string }
  | { ruleId: "rehydrate-malformed-percentage"; message: string }
  | { ruleId: "rehydrate-corrupt-definition"; message: string }
  | { ruleId: "rehydrate-missing-start-marker"; message: string }
  | { ruleId: "rehydrate-unexpected-start"; message: string }
  | { ruleId: "rehydrate-namespace-violation"; message: string };

// offset's input-shape refusals (not a single offset expression) and its
// unresolved arm. The unresolved arm carries the blocking reason as a typed field
// — resolveVestingStart always produces one, so it's required, not optional.
type OffsetError =
  | { ruleId: "offset-not-single-expression"; message: string }
  | { ruleId: "offset-unresolved"; message: string; unresolved: string };

// verify's own refusals — an input the caller controls (grant quantity below one,
// or no observations) and the one schedule-side refusal it adds beyond the shared
// parse/evaluate arms: an over-allocating program, whose broken denominator makes
// the percent-of-grant comparison meaningless.
type VerifyError =
  | { ruleId: "verify-invalid-grant-quantity"; message: string }
  | { ruleId: "verify-no-observations"; message: string }
  | { ruleId: "verify-over-allocation"; message: string };

export type PipelineError =
  | SharedError
  | PersistError
  | RehydrateError
  | OffsetError
  | VerifyError;

// A success carries its own named payload (e.g. `{ program }`); a failure
// carries the error. Callers branch on `ok`.
export type Result<T> =
  | ({ ok: true } & T)
  | { ok: false; error: PipelineError };

export function toPipelineError(err: unknown): PipelineError {
  // `@vestlang/dsl` owns the thrown-error shape; we just map its classified
  // result into the `syntax-error` arm. A located throw carries a `loc` (a
  // `SourceLocation`, structurally assignable to our local `Loc`); a
  // position-less one drops it.
  const { message, loc } = toParseError(err);
  return { ruleId: "syntax-error", message, ...(loc ? { loc } : {}) };
}

// For things the engine throws mid-evaluation (e.g. the installment cap). These
// aren't positional, so no loc.
export function toEvaluationError(err: unknown): PipelineError {
  return {
    ruleId: "evaluation-error",
    message: err instanceof Error ? err.message : String(err),
  };
}

// Parse + normalize: the canonical Program the evaluator consumes. Used by every
// run* entry point and by `compile`.
export function parseToProgram(dsl: string): Result<{ program: Program }> {
  try {
    const program = normalizeProgram(parse(dsl));
    return { ok: true, program };
  } catch (err) {
    return { ok: false, error: toPipelineError(err) };
  }
}

// Parse without normalizing — the raw AST, for surfaces that want to inspect the
// pre-normalization structure (the MCP `parse` tool, the CLI `inspect` command).
export function parseRaw(dsl: string): Result<{ ast: RawProgram }> {
  try {
    return { ok: true, ast: parse(dsl) };
  } catch (err) {
    return { ok: false, error: toPipelineError(err) };
  }
}
