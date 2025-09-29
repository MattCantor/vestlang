// packages/normalizer/src/errors.ts
// Consistent, debuggable errors from normalizer with codes and contextual metadata

export type NormalizerErrorCode =
  | "EMPTY_WINDOW_AFTER_RESOLVE" // runtime resolution found (start > end) or equal-but-exclusive
  | "INVALID_OVER_EVERY" // OVER present without EVERY, etc. (if you enforce here too)
  | "UNSUPPORTED_ANCHOR_COMPARISON" // tried to order incomparable anchors in normalizer
  | "UNEXPECTED_AST_SHAPE" // AST didn’t match expected variants
  | "MISSING_REQUIRED_FIELD" // generic “field missing” guard
  | "INVARIANT"; // generic invariant failure

export class NormalizerError extends Error {
  readonly code: NormalizerErrorCode;
  readonly path?: string[]; // breadcrumb path to the node, if you thread it
  readonly meta?: Record<string, unknown>;

  constructor(
    code: NormalizerErrorCode,
    message: string,
    meta?: Record<string, unknown>,
    path?: string[],
  ) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.meta = meta;
    this.path = path;
  }
}

// Convenience factories
export function invariant(
  cond: any,
  message: string,
  meta?: Record<string, unknown>,
  path?: string[],
): asserts cond {
  if (!cond) throw new NormalizerError("INVARIANT", message, meta, path);
}

export function unexpectedAst(
  message: string,
  meta?: Record<string, unknown>,
  path?: string[],
): never {
  throw new NormalizerError("UNEXPECTED_AST_SHAPE", message, meta, path);
}

export function unsupportedCompare(
  meta?: Record<string, unknown>,
  path?: string[],
) {
  throw new NormalizerError(
    "UNSUPPORTED_ANCHOR_COMPARISON",
    "Cannot compare anchors at normalization time.",
    meta,
    path,
  );
}
