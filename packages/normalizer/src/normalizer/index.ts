import {
  Program,
  RawProgram,
  type Diagnostic,
  type SourceLocation,
  type ScheduleExprTag,
  type NodeExprTag,
  selectorKeyword,
} from "@vestlang/types";
import { normalizeStatement } from "./program.js";
import type { FindingSink, NormalizationFinding } from "./utils.js";

/** Sink for diagnostics the normalizer raises about what it canonicalized away. */
export type NormalizeSink = (d: Diagnostic) => void;

// Selector tags only ever reach the `duplicate-selector` finding (its report is
// wired to selector call sites), so the cast back to `selectorKeyword`'s input is
// sound.
type SelectorExprTag = Exclude<
  ScheduleExprTag | NodeExprTag,
  "SCHEDULE" | "NODE"
>;

// AND binds tighter than OR, so a bare mix groups silently. Teach the grouping
// rather than prescribe a rewrite: show both candidate groupings so the author
// can confirm which one the precedence gave them.
const MIXED_BOOLEAN_MESSAGE =
  "AND binds tighter than OR, so a mixed `… OR … AND …` groups the AND first: " +
  "`a OR b AND c` means `a OR (b AND c)`, not `(a OR b) AND c`. " +
  "Check that this is the grouping you intended.";

// Map a finding to its diagnostic, stamping the statement's path. The exhaustive
// switch turns a new finding variant into a compile error until it's handled.
function toDiagnostic(
  finding: NormalizationFinding,
  stmtIndex: number,
): Diagnostic {
  switch (finding.kind) {
    case "duplicate-selector":
      return {
        ruleId: "no-duplicate-selector-items",
        severity: "warning",
        message: `${selectorKeyword(finding.selectorType as SelectorExprTag)} contains duplicate items`,
        path: ["Program", stmtIndex],
      };
    case "mixed-boolean":
      return {
        ruleId: "no-implicit-mixed-boolean",
        severity: "warning",
        message: MIXED_BOOLEAN_MESSAGE,
        path: ["Program", stmtIndex],
        loc: cleanLoc(finding.loc),
      };
  }
}

// Peggy's `location()` also carries `offset`/`source`; keep just the line/column
// span the Diagnostic vocabulary defines.
function cleanLoc(loc: SourceLocation): SourceLocation {
  return {
    start: { line: loc.start.line, column: loc.start.column },
    end: { line: loc.end.line, column: loc.end.column },
  };
}

/* ------------------------
 * Public API
 * ------------------------ */

/**
 * Normalize a parsed program for deterministic shape and CNF-friendly structure.
 *
 * ## Post-conditions / Invariants
 * - **Selectors (EARLIER_OF/LATER_OF)**: flattened, sorted, deduped.
 * - **Conditions**:
 *   - Only `ATOM`, `AND`, `OR` forms.
 *   - Boolean nodes flattened, singleton-collapsed, sorted, deduped.
 *
 * Idempotent: running `normalizeProgram` multiple times yields the same AST.
 *
 * This keeps its own recursion rather than the shared `@vestlang/walk`
 * traversal, for two reasons. It runs on the *raw* AST — vesting starts may be
 * null, a cliff may be a bare `Duration` — and `walk` only understands the
 * normalized shape this function produces. And it doesn't merely observe the
 * tree, it rewrites it (resolving starts, flattening/sorting/deduping selectors
 * and bools), which a read-only walk can't express. `walk` is for the consumers
 * downstream of here.
 *
 * @param stmts A `Program` of parsed statements (Statement[]) from the DSL parser
 * @param sink Optional. Receives a diagnostic when normalization notices
 *   something the output no longer shows — a duplicate selector arm dropped by
 *   dedupe, or a bare mixed `AND`/`OR` the precedence grouped silently.
 *   `lintText` passes this; most callers don't care.
 * @returns Normalized statements (same cardinality as input)
 *
 * @example
 *  const ast = parse(src) as Statement[];
 *  const norm = normalizeProgram(ast);
 *  // `norm` will be fed to downstream (e.g., Open Cap Table, CNF converter)
 */
export function normalizeProgram(
  stmts: RawProgram,
  sink?: NormalizeSink,
): Program {
  return stmts.map((s, i) => {
    const report: FindingSink | undefined = sink
      ? (finding) => sink(toDiagnostic(finding, i))
      : undefined;
    return normalizeStatement(s, report);
  });
}
