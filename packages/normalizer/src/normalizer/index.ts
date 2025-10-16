import { Program } from "@vestlang/types";
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
 * @param stmts A `Program` of parsed statements (Statement[]) from the DSL parser
 * @returns Normalized statements (same cardinality as input)
 *
 * @example
 *  const ast = parse(src) as Statement[];
 *  const norm = normalizeProgram(ast);
 *  // `norm` will be fed to downstream (e.g., Open Cap Table, CNF converter)
 */
export function normalizeProgram(stmts: Program): Program {
  return stmts.map(normalizeStatement);
}
