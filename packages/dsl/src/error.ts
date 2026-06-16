// The thrown-error contract for `parse`. `parse` throws on a syntax error
// (peggy's own `SyntaxError` subclass, re-exported from the generated grammar).
// This is the one place that knows that shape: `toParseError` is a total
// classifier that turns any unknown throw into a `ParseError` — a message plus,
// when the throw is a located peggy syntax error, a source span. Consumers
// (pipeline, linter) map this neutral result into their own vocabulary rather
// than each re-deriving the located/position-less split.

import * as parser from "./generated/grammar.js";
import type { SourceLocation } from "@vestlang/types";

// What a classified parse failure looks like to a consumer. `loc` is present
// for a located peggy `SyntaxError` and absent for anything else — the grammar's
// bare global `SyntaxError` guards, a normalizer invariant throw, a non-`Error`
// value. `loc` reuses `@vestlang/types`' `SourceLocation` rather than minting a
// parallel coordinate type.
export type ParseError = {
  message: string;
  loc?: SourceLocation;
};

// `instanceof parser.SyntaxError` is safe here because the classifier is
// co-bundled with the parser in the one `@vestlang/dsl` module on every consumer
// path — no cross-realm boundary. The only throws carrying both a SyntaxError
// name and a `.location` are these instances. Everything else (bare global
// SyntaxErrors, normalizer throws, non-`Error` values) classifies to a
// position-less `ParseError`, with the message derived the same way
// `toEvaluationError` derives its own.
export function toParseError(err: unknown): ParseError {
  if (err instanceof parser.SyntaxError) {
    const { start, end } = err.location;
    return {
      message: err.message ?? "Syntax error",
      loc: {
        start: { line: start.line, column: start.column },
        end: { line: end.line, column: end.column },
      },
    };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}
