// The pipeline's one error shape, and the two ways into the parser.
//
// Every failure a consumer can hit — a syntax error in the DSL, or the engine
// throwing partway through evaluation — comes back as a `PipelineError`, so the
// CLI and the MCP server each map failures to their own output (a stderr line, a
// JSON `{ error }`) in exactly one place.

import { parse, asParseFailure } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type { Program, RawProgram } from "@vestlang/types";

export type Loc = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

// Discriminated on `ruleId`. A location only makes sense for a syntax error
// (it points at a span of source), so `loc` lives in that arm — an
// evaluation-error can't accidentally carry one.
export type PipelineError =
  | { ruleId: "syntax-error"; message: string; loc?: Loc }
  | { ruleId: "evaluation-error"; message: string };

// A success carries its own named payload (e.g. `{ program }`); a failure
// carries the error. Callers branch on `ok`.
export type Result<T> =
  | ({ ok: true } & T)
  | { ok: false; error: PipelineError };

export function toPipelineError(err: unknown): PipelineError {
  // `@vestlang/dsl` owns the thrown-error shape; we just map its decode into the
  // `syntax-error` arm. The decoded `loc` (a `SourceLocation`) is structurally
  // assignable to our local `Loc`.
  const failure = asParseFailure(err);
  if (failure) {
    return {
      ruleId: "syntax-error",
      message: failure.message,
      loc: failure.loc,
    };
  }
  // Not a located peggy error (defensive fallback): keep it a loc-less
  // `syntax-error`.
  return {
    ruleId: "syntax-error",
    message: (err as { message?: string })?.message ?? String(err),
  };
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
