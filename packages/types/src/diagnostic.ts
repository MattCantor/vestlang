// Structured diagnostic vocabulary, shared across the repo.
//
// The linter is the obvious producer, but it isn't the only one: the normalizer
// emits a diagnostic when it dedupes a duplicate selector arm (the catch the
// dead `no-duplicate-selector-items` rule used to promise), and the linter
// depends on the normalizer — so the type can't live in the linter without an
// import cycle. It sits here, at the dependency floor, so both can speak it.

import type { Fraction } from "./canonical.js";
import type { Numeric } from "./helpers.js";

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
//
// `precision-insufficient` is the precision-analyzer guard's channel: a stored
// percentage is a fixed-point decimal (a Numeric), so a repeating share like 1/3
// only reaches the ten-place grid, and at some grant sizes no point on that grid
// allocates to the whole-share count the exact share calls for. The evaluator runs
// the analyzer on each stored percentage against the fraction it was written from
// and raises this warning (not an error — the schedule is still valid, it just
// allocates a share or two off the exact fraction). It carries everything a message
// needs straight off the analyzer: the decimal as written, the share basis it was
// measured against, the fraction it stands for, and — where a caller can name one —
// a decimal that would have allocated correctly.
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
    }
  | {
      kind: "precision-insufficient";
      severity: "warning";
      // The stored decimal as written, and the share count reported to the human.
      // The verdict itself runs at grant scale (one floor of stmtFraction × decimal
      // × grant, reproducing the realizer's lump); the reported `shareCount` stays
      // the statement's share of the grant — floor(stmtFraction × grant) — so the
      // message ("too imprecise for N shares") names the basis the reader thinks in.
      percentage: Numeric;
      shareCount: number;
      // The exact share the percentage stands for, e.g. 1/3.
      inferred: Fraction;
      // A shorter decimal that allocates to the intended count, where one can be
      // named. Undefined when no ≤10-place decimal lands it, and deliberately
      // omitted on a `conservative` finding (see below).
      recommended?: Numeric;
      // True when the cliff lump is NOT first in line at its merged position — a
      // sibling vests before it, so the realized lump is path-dependent and no
      // stored decimal is provably exact. The guard then warns conservatively
      // (preferring an over-warn to a silent share loss) and makes no `recommended`
      // claim it can't stand behind. The renderer words this differently from a
      // not-representable finding (which also has no `recommended`).
      conservative?: boolean;
      path?: NodePath;
    }
  // Event ids are case-sensitive (a firing only satisfies a gate on an exact key
  // match), but every DSL keyword is case-insensitive — so a firing whose case
  // doesn't match the referenced id silently never matches, and the schedule pends
  // with no signal. This advisory catches the likely typo: a referenced id with no
  // exact firing but a case-only twin among the firings provided. It never changes
  // resolution (the grant still pends) and never invalidates the schedule — it's a
  // warning, the same way an unreferenced firing is harmless rather than rejected.
  | {
      kind: "event-firing-case-mismatch";
      severity: "warning";
      // The id as written in the DSL (the EVENT node's value).
      referenced: string;
      // The firing key that differs from it only by case.
      fired: string;
      path?: NodePath;
    };
