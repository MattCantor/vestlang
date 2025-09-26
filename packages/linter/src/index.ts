import type { t } from "@vestlang/dsl";

export interface LintIssue {
  code: string;
  message: string;
  fix?: string;
  path?: string; // optional breadcrumb to where the issue was found
}

export function lint(stmt: t.Statement): LintIssue[] {
  const issues: LintIssue[] = [];
  walkTop(stmt.top, (program, path) => {
    const after = isSingletonAfter(program.if);
    const isOneShotSchedule =
      !!program.schedule &&
      program.schedule.over?.value === 0 &&
      program.schedule.every?.value === 0;

    // Rule: Prefer SCHEDULE OVER D EVERY D over IF AFTER D when IF is singleton
    if (after && !isOneShotSchedule) {
      const d = (program.if as t.After).duration;
      const dText = `${d.value} ${d.unit}`;
      issues.push({
        code: "PREFER_SCHEDULE_ONE_SHOT",
        message:
          "Prefer `SCHEDULE OVER D EVERY D` for pure time-only one-shots (use time in the schedule, not IF).",
        fix: `Rewrite as: SCHEDULE FROM grantDate OVER ${dText} EVERY ${dText}  (and remove \`IF AFTER ${dText}\`).`,
        path,
      });
    }
  });
  return issues;
}

/* ---------------- helpers ---------------- */

function isSingletonAfter(
  cond: t.Condition | null | undefined,
): cond is t.After {
  if (!cond) return false;
  return cond.kind === "After";
}

function walkTop(
  node: t.TopStmt,
  visitProgram: (p: t.Program, path: string) => void,
  path: string = "top",
): void {
  switch (node.kind) {
    case "Program":
      visitProgram(node, path);
      return;
    case "EarlierOfPrograms":
    case "LaterOfPrograms": {
      node.items.forEach((child, i) =>
        walkTop(child, visitProgram, `${path}.${node.kind}[${i}]`),
      );
      return;
    }
    default:
      // future-proof: if new kinds are added
      return;
  }
}
