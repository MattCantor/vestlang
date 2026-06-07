// Structured diagnostic vocabulary, shared across the repo.
//
// The linter is the obvious producer, but it isn't the only one: the normalizer
// emits a diagnostic when it dedupes a duplicate selector arm (the catch the
// dead `no-duplicate-selector-items` rule used to promise), and the linter
// depends on the normalizer — so the type can't live in the linter without an
// import cycle. It sits here, at the dependency floor, so both can speak it.

import type { Fraction } from "./canonical.js";

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

// A Finding is something the engine notices about a whole schedule once it has
// resolved — distinct from a Diagnostic, which the linter raises about a node in
// the source. The one we care about today: a schedule that allocates more (or, in
// future, less) than 100% of the grant.
//
// Why a union keyed on `kind` rather than a flat record? Two reasons. First, the
// severity isn't a free choice: vesting more than the grant is always an error,
// vesting less is always a warning (it's legal to leave shares unvested). Pinning
// the severity to each variant means you can't accidentally build an
// over-allocation tagged "warning". Second, `sum` carries the actual figure (e.g.
// 3/2 for a 150% schedule) as data, so a consumer reads the number directly
// instead of scraping it out of a message string. The human-readable text is
// produced on demand from these fields, not stored here.
//
// `severity` reuses the same vocabulary as Diagnostic so both can be filtered
// together (e.g. "any errors?"). `under-allocation` is defined now but only
// produced in a later phase.
export type Finding =
  | {
      kind: "over-allocation";
      severity: "error";
      sum: Fraction;
      path?: NodePath;
    }
  | {
      kind: "under-allocation";
      severity: "warning";
      sum: Fraction;
      path?: NodePath;
    };
