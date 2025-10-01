// packages/linter/src/index.ts
import type {
  ASTStatement,
  ASTExpr,
  FromTerm,
  QualifiedAnchor,
  TemporalPredNode,
  Duration,
} from "@vestlang/dsl";
import { normalizeExpr } from "@vestlang/normalizer";

/** A single linter warning (non-blocking). */
export interface LintIssue {
  code: string; // machine readable
  message: string; // human readable
  fix?: string; // optional, suggested rewrite
  path?: string; // breadcrumb, e.g. "expr.items[1].from"
}

/** Entry point: lint a parsed Statement (parser AST). */
export function lint(stmt: ASTStatement): LintIssue[] {
  const out: LintIssue[] = [];

  // 1) Raw AST checks (predicates & lists)
  lintExpr(stmt.expr, "expr", out);

  // 2) Normalized checks (uses normalizer for schedule defaults consolidation)
  const norm = normalizeExpr(stmt.expr);
  lintNormalizedExpr(norm as any, "expr", out);

  return out;
}

/* =========================================================
 * Raw AST checks (no mutation)
 * =======================================================*/

function lintExpr(node: ASTExpr, path: string, out: LintIssue[]) {
  switch (node.type) {
    case "Schedule":
      if (node.from) lintFromTerm(node.from, `${path}.from`, out);
      if (node.cliff) lintCliff(node.cliff as any, `${path}.cliff`, out);
      return;

    case "EarlierOfSchedules":
    case "LaterOfSchedules": {
      const seen = new Set<string>();
      node.items.forEach((child, i) => {
        // duplicate schedules by structural equality
        const key = stableKey(child);
        if (seen.has(key)) {
          out.push({
            code: "LINT-LIST-DUP",
            message: `${node.type} contains a duplicate item at index ${i}`,
            path: `${path}.items[${i}]`,
          });
        } else {
          seen.add(key);
        }
        lintExpr(child, `${path}.items[${i}]`, out);
      });
      if (node.items.length === 1) {
        out.push({
          code: "LINT-LIST-SINGLETON",
          message: `${node.type} with a single item is unnecessary`,
          fix: "Inline the single schedule and remove the combinator.",
          path,
        });
      }
      return;
    }
  }
}

function lintFromTerm(node: FromTerm, path: string, out: LintIssue[]) {
  if (isQualified(node)) {
    const preds = node.predicates ?? [];
    if (preds.length === 0) {
      out.push({
        code: "LINT-PRED-EMPTY",
        message: "Qualified anchor has no predicates.",
        fix: "Remove the 'Qualified' wrapper.",
        path,
      });
    }
    lintPredicates(preds, `${path}.predicates`, out);
    return;
  }

  if (isEarlierOfFrom(node) || isLaterOfFrom(node)) {
    const items = node.items;
    // duplicates / singleton
    const seen = new Set<string>();
    items.forEach((it, i) => {
      const key = stableKey(it);
      if (seen.has(key)) {
        out.push({
          code: "LINT-LIST-DUP",
          message: "EarlierOf/LaterOf contains duplicate items.",
          path: `${path}.items[${i}]`,
        });
      } else {
        seen.add(key);
      }
      lintFromTerm(it, `${path}.items[${i}]`, out);
    });
    if (items.length === 1) {
      out.push({
        code: "LINT-LIST-SINGLETON",
        message: "EarlierOf/LaterOf with a single item is unnecessary.",
        fix: "Inline the single item.",
        path,
      });
    }
    return;
  }

  // bare Anchor: nothing to lint here
}

function lintCliff(node: any, path: string, out: LintIssue[]) {
  if (isQualified(node)) {
    lintPredicates(node.predicates ?? [], `${path}.predicates`, out);
    return;
  }
  if (isEarlierOf(node) || isLaterOf(node)) {
    node.items.forEach((it: any, i: number) =>
      lintCliff(it, `${path}.items[${i}]`, out),
    );
  }
}

function lintPredicates(
  preds: TemporalPredNode[],
  path: string,
  out: LintIssue[],
) {
  const afters = preds.filter((p) => p.type === "After");
  const befores = preds.filter((p) => p.type === "Before");

  if (afters.length > 1) {
    out.push({
      code: "LINT-PRED-REDUNDANT",
      message: "Multiple AFTER predicates; only the latest boundary matters.",
      fix: "Keep only the tightest (later) AFTER.",
      path,
    });
  }
  if (befores.length > 1) {
    out.push({
      code: "LINT-PRED-REDUNDANT",
      message:
        "Multiple BEFORE predicates; only the earliest boundary matters.",
      fix: "Keep only the tightest (earlier) BEFORE.",
      path,
    });
  }

  if (afters.length === 1 && befores.length === 1) {
    // If strict flags match, suggest BETWEEN
    if (afters[0].strict === befores[0].strict) {
      out.push({
        code: "LINT-PRED-CONJ-TO-BETWEEN",
        message: "AFTER … AND BEFORE … can be expressed as BETWEEN … AND …",
        fix: `Use ${afters[0].strict ? "STRICTLY BETWEEN" : "BETWEEN"} <start> AND <end>.`,
        path,
      });
    }
  }

  // Date-only validations for BETWEEN (parser allows; evaluator would fail later)
  for (const p of preds) {
    if (p.type === "Between" && p.a.type === "Date" && p.b.type === "Date") {
      if (p.a.value > p.b.value) {
        out.push({
          code: "LINT-PRED-DATE-ORDER",
          message: `BETWEEN has start > end (${p.a.value} > ${p.b.value}).`,
          fix: "Swap the endpoints or correct the dates.",
          path,
        });
      }
      if (p.a.value === p.b.value && p.strict) {
        out.push({
          code: "LINT-PRED-EQUAL-STRICT",
          message: "STRICTLY BETWEEN identical endpoints is an empty set.",
          fix: "Drop STRICTLY or choose different endpoints.",
          path,
        });
      }
    }
  }
}

/* =========================================================
 * Normalized checks (post-normalizer)
 * =======================================================*/

function lintNormalizedExpr(node: any, path: string, out: LintIssue[]) {
  if (node.type === "Schedule") {
    const s = node as {
      over: Duration;
      every: Duration;
      cliff?: { type: string } | undefined;
      // fromWindow is available but we don't validate emptiness here
    };
    const over0 = s.over?.type === "Duration" && s.over.value === 0;
    const every0 = s.every?.type === "Duration" && s.every.value === 0;
    const cliffZero = !s.cliff || s.cliff.type === "Zero";

    if (over0 && every0 && cliffZero) {
      out.push({
        code: "LINT-SCHED-REDUNDANT-ZERO",
        message: "Explicit OVER 0 / EVERY 0 with Zero cliff is redundant.",
        fix: "Omit OVER/EVERY and CLIFF; rely on Schedule defaults.",
        path,
      });
    }
    return;
  }
  if (node.type === "EarlierOfSchedules" || node.type === "LaterOfSchedules") {
    node.items.forEach((it: any, i: number) =>
      lintNormalizedExpr(it, `${path}.items[${i}]`, out),
    );
  }
}

/* =========================================================
 * Tiny helpers (no external deps)
 * =======================================================*/

function isQualified(x: any): x is QualifiedAnchor {
  return !!x && typeof x === "object" && x.type === "Qualified";
}
function isEarlierOfFrom(
  x: any,
): x is { type: "EarlierOf"; items: FromTerm[] } {
  return (
    !!x &&
    typeof x === "object" &&
    x.type === "EarlierOf" &&
    Array.isArray(x.items)
  );
}
function isLaterOfFrom(x: any): x is { type: "LaterOf"; items: FromTerm[] } {
  return (
    !!x &&
    typeof x === "object" &&
    x.type === "LaterOf" &&
    Array.isArray(x.items)
  );
}
function isEarlierOf(x: any): x is { type: "EarlierOf"; items: any[] } {
  return (
    !!x &&
    typeof x === "object" &&
    x.type === "EarlierOf" &&
    Array.isArray(x.items)
  );
}
function isLaterOf(x: any): x is { type: "LaterOf"; items: any[] } {
  return (
    !!x &&
    typeof x === "object" &&
    x.type === "LaterOf" &&
    Array.isArray(x.items)
  );
}

/** Stable-ish structural key; fine for linter duplicate detection. */
function stableKey(x: unknown): string {
  try {
    return JSON.stringify(x);
  } catch {
    return Object.prototype.toString.call(x);
  }
}
