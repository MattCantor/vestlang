import type { t } from "@vestlang/dsl";

export interface LintIssue {
  code: string;
  message: string;
  fix?: string;
}

export function lint(stmt: t.Statement): LintIssue[] {
  const issues: LintIssue[] = [];
  // Rule: Prefer SCHEDULE OVER D EVERY D over IF AFTER D when IF is singleton
  if (!stmt.schedule && stmt.if && stmt.if.kind === "After") {
    issues.push({
      code: "PREFER_SCHEDULE_ONE_SHOT",
      message: "Prefer `SCHEDULE OVER D EVERY D` for pure time-only one-shots.",
      fix: "Add `SCHEDULE FROM grantDate OVER <D> EVERY <D>` and drop `IF AFTER <D>`.",
    });
  }
  return issues;
}
