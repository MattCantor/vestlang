import { Program, RawProgram } from "@vestlang/types";
import { normalizeStatement } from "./program.js";

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
 * @returns Normalized statements (same cardinality as input)
 *
 * @example
 *  const ast = parse(src) as Statement[];
 *  const norm = normalizeProgram(ast);
 *  // `norm` will be fed to downstream (e.g., Open Cap Table, CNF converter)
 */
export function normalizeProgram(stmts: RawProgram): Program {
  return stmts.map(normalizeStatement);
}
