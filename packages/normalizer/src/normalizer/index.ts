import {
  Program,
  RawProgram,
  type Diagnostic,
  type ScheduleExprTag,
  type NodeExprTag,
  selectorKeyword,
} from "@vestlang/types";
import { normalizeStatement } from "./program.js";

/** Sink for diagnostics the normalizer raises about what it canonicalized away. */
export type NormalizeSink = (d: Diagnostic) => void;

// Selector tags only ever reach the sink (the dedupe report is wired to selector
// call sites), so the cast back to `selectorKeyword`'s input is sound.
type SelectorExprTag = Exclude<
  ScheduleExprTag | NodeExprTag,
  "SCHEDULE" | "NODE"
>;

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
 * @param sink Optional. Receives a diagnostic when normalization erases an
 *   authoring slip the output no longer shows — currently a duplicate selector
 *   arm dropped by dedupe. `lintText` passes this; most callers don't care.
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
    const report = sink
      ? (selectorType: string) =>
          sink({
            ruleId: "no-duplicate-selector-items",
            severity: "warning",
            message: `${selectorKeyword(selectorType as SelectorExprTag)} contains duplicate items`,
            path: ["Program", i],
          })
      : undefined;
    return normalizeStatement(s, report);
  });
}
