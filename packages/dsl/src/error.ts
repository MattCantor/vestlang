// The thrown-error contract for `parse`. `parse` throws on a syntax error
// (peggy's own `SyntaxError` subclass, re-exported from the generated grammar),
// and consumers used to each duck-type that throw to pull a location out of it.
// This is the one place that knows that shape: `asParseFailure` turns an unknown
// throw into a structured `ParseFailure`, or `undefined` when the throw isn't a
// located peggy syntax error.

import * as parser from "./generated/grammar.js";
import type { SourceLocation } from "@vestlang/types";

// What a structured parse failure looks like to a consumer: a message and a
// span. `loc` is required — a peggy `SyntaxError` always carries a location;
// the throws that don't (the grammar's bare global `SyntaxError` guards) decode
// to `undefined` instead. `loc` reuses `@vestlang/types`' `SourceLocation`
// rather than minting a parallel coordinate type.
export type ParseFailure = {
  message: string;
  loc: SourceLocation;
};

// `instanceof parser.SyntaxError` is safe here because the decoder is co-bundled
// with the parser in the one `@vestlang/dsl` module on every consumer path — no
// cross-realm boundary. The only throws carrying both a SyntaxError name and a
// `.location` are these instances; the grammar's bare `new SyntaxError(...)`
// guards are global SyntaxErrors with no location and fall through to undefined.
export function asParseFailure(err: unknown): ParseFailure | undefined {
  if (!(err instanceof parser.SyntaxError)) return undefined;
  const { start, end } = err.location;
  return {
    message: err.message ?? "Syntax error",
    loc: {
      start: { line: start.line, column: start.column },
      end: { line: end.line, column: end.column },
    },
  };
}
