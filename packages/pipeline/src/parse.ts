// The pipeline's one error shape, and the two ways into the parser.
//
// Every failure a consumer can hit — a syntax error in the DSL, or the engine
// throwing partway through evaluation — comes back as a `PipelineError`, so the
// CLI and the MCP server each map failures to their own output (a stderr line, a
// JSON `{ error }`) in exactly one place.

import { parse } from "@vestlang/dsl";
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

// Shape of a thrown peggy parse error. After the grammar's reachable guards were
// moved onto peggy's error(), every syntax error we can actually hit carries a
// `.location`; the loc-less branch below is a defensive fallback.
type ThrownParseError = {
  name?: string;
  message?: string;
  location?: Loc;
};

export function toPipelineError(err: unknown): PipelineError {
  const e = err as ThrownParseError;
  if (e?.name === "SyntaxError" && e.location) {
    return {
      ruleId: "syntax-error",
      message: e.message ?? "Syntax error",
      loc: {
        start: { line: e.location.start.line, column: e.location.start.column },
        end: { line: e.location.end.line, column: e.location.end.column },
      },
    };
  }
  return {
    ruleId: "syntax-error",
    message: e?.message ?? String(err),
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
