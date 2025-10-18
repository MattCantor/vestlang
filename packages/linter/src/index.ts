import { normalizeProgram } from "@vestlang/normalizer";
import { Program } from "@vestlang/types";

/** A single linter warning (non-blocking). */
export interface LintIssue {
  code: string; // machine readable
  message: string; // human readable
  fix?: string; // optional, suggested rewrite
  path?: string; // breadcrumb, e.g. "expr.items[1].from"
}

/** Entry point: lint a parsed Statement (parser AST). */
export function lint(stmt: Program): LintIssue[] {
  const out: LintIssue[] = [];

  // 1) Raw AST checks (predicates & lists)
  // lintExpr(stmt.expr, "expr", out);

  // 2) Normalized checks (uses normalizer for schedule defaults consolidation)
  // const norm = normalizeProgram(stmt);
  // lintNormalizedProgram(norm as any, "expr", out);

  return out;
}
