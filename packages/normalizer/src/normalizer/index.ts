import { ASTStatement } from "@vestlang/dsl";
import { normalizeStatement } from "./program.js";

/* ------------------------
 * Public API
 * ------------------------ */

/**
 * Normalize a parsed program for deterministic shape and CNF-friendly structure.
 *
 * ## Post-conditions / Invariants
 * - **Selectors (EARLIER_OF/LATER_OF)**: flattened, sorted, deduped.
 * - **Vesting nodes**: offsets canonicalized to <= 1 MONTHS and <=1 DAYS entry, zeroes dropped.
 * - **Conditions**:
 *   - Only `ATOM`, `AND`, `OR` forms.
 *   - Boolean nodes flattened, singleton-collapsed, sorted, deduped.
 *   - No `ATOM` has a `CONSTRAINED` base. These constraints are **hoisted** out.
 *
 * Idempotent: running `normalizeProgram` multiple times yields the same AST.
 *
 * @param stmts Parsed statements (ASTStatement[]) from the DSL parser
 * @returns Normalized statements (same cardinality as input)
 *
 * @example
 *  const ast = parse(src) as ASTStatement[];
 *  const norm = normalizeProgram(ast);
 *  // `norm` will be fed to downstream (e.g., Open Cap Table, CNF converter)
 */
export function normalizeProgram(stmts: ASTStatement[]): ASTStatement[] {
  return stmts.map(normalizeStatement);
}
