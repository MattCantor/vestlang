// Structured diagnostic vocabulary, shared across the repo.
//
// The linter is the obvious producer, but it isn't the only one: the normalizer
// emits a diagnostic when it dedupes a duplicate selector arm (the catch the
// dead `no-duplicate-selector-items` rule used to promise), and the linter
// depends on the normalizer — so the type can't live in the linter without an
// import cycle. It sits here, at the dependency floor, so both can speak it.

// How a diagnostic addresses the node it's about: a field name ("expr",
// "cliff") or an array index (a selector / AND / OR arm). Mirrors a walk path.
export type NodePath = (string | number)[];

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface SourcePosition {
  line: number;
  column: number;
}

export interface SourceLocation {
  start: SourcePosition;
  end: SourcePosition;
}

export interface Diagnostic {
  ruleId: string;
  message: string;
  severity: DiagnosticSeverity;
  path: NodePath;
  loc?: SourceLocation;
  codeFrame?: string;
}
