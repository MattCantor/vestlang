import type {
  Amount,
  Condition,
  Constraint,
  Duration,
  Offsets,
  Program,
  Schedule,
  ScheduleExpr,
  Statement,
  VestingBase,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import {
  group,
  ifBreak,
  indent,
  join,
  line,
  softline,
  type Doc,
} from "./doc.js";

/**
 * The single AST → Doc traversal. Both renderings descend from here: the flat
 * (infinite-width) print is the canonical string, the width-aware print is the
 * prettier formatter. The sugar collapse and pluralization live here and
 * nowhere else, so the two outputs can't disagree.
 *
 * The layout is adaptive and two-shape: a statement is either its one-line
 * sentence form or its fully-expanded stanza (VEST alone, then FROM / the
 * cadence / CLIFF each on its own indented line), never a partial mix. The
 * break is all-or-nothing because the statement is one group; selectors and
 * conditions are their own groups, so they expand independently.
 *
 * Operates on the NORMALIZED AST (vesting starts resolved to nodes, cliffs to
 * VestingNodeExpr). The prettier plugin normalizes in its parser before
 * handing nodes here.
 */
export function toDoc(node: Statement | Program): Doc {
  return Array.isArray(node) ? toDocProgram(node) : toDocStatement(node);
}

function toDocProgram(p: Program): Doc {
  if (p.length === 0) return "";
  if (p.length === 1) return toDocStatement(p[0]);
  // `[ s1, s2 ]` when it fits; one statement per line with a trailing comma
  // when it doesn't.
  return group([
    "[",
    indent([line, join([",", line], p.map(toDocStatement))]),
    ifBreak(","),
    line,
    "]",
  ]);
}

function toDocStatement(s: Statement): Doc {
  const head: Doc[] = [];
  const amount = toDocAmount(s.amount);
  if (!isEmpty(amount)) head.push(amount, " ");
  head.push(kw("VEST"));

  // A singleton schedule becomes the expandable stanza: VEST on its own line,
  // then each clause indented under it. A schedule selector is not a stanza —
  // it rides next to VEST and breaks via its own paren-group.
  if (s.expr.type === "SINGLETON") {
    const clauses = scheduleClauses(s.expr);
    if (clauses.length === 0) return group(head);
    return group([head, indent(clauses.flatMap((c) => [line, c]))]);
  }
  return group([...head, " ", toDocScheduleExpr(s.expr)]);
}

function toDocScheduleExpr(e: ScheduleExpr): Doc {
  switch (e.type) {
    case "SINGLETON":
      // Inline form (e.g. as a selector item): no stanza breaking.
      return spaced(scheduleClauses(e));
    case "LATER_OF":
    case "EARLIER_OF":
      return parenGroup(
        kw(e.type.replace("_", " ")),
        e.items.map(toDocScheduleExpr),
      );
  }
}

/**
 * The clauses of a singleton schedule, in grammar order: an optional FROM, the
 * cadence (OVER…EVERY, one unbreakable unit), and an optional CLIFF. Returned
 * as a list so the statement can lay them inline or one-per-line.
 */
function scheduleClauses(s: Schedule): Doc[] {
  const clauses: Doc[] = [];

  // FROM clause:
  //   - omit entirely if it's the default grantDate with no offsets/conditions
  //   - sugar `EVENT grantDate +N` back to the bare `FROM N` the grammar accepts
  if (!isDefaultVestingStart(s.vesting_start)) {
    const sugared = sugaredAnchorDuration(s.vesting_start, "grantDate");
    clauses.push([
      kw("FROM"),
      " ",
      sugared ?? toDocVestingNodeExpr(s.vesting_start),
    ]);
  }

  const cadence = toDocPeriodicity(s.periodicity);
  if (!isEmpty(cadence)) clauses.push(cadence);

  // CLIFF: same bare-duration sugar, anchored on vestingStart.
  if (s.periodicity.cliff) {
    const sugared = sugaredAnchorDuration(s.periodicity.cliff, "vestingStart");
    clauses.push([
      kw("CLIFF"),
      " ",
      sugared ?? toDocVestingNodeExpr(s.periodicity.cliff),
    ]);
  }

  return clauses;
}

function toDocPeriodicity(p: VestingPeriod): Doc {
  if (p.length === 0) return "";
  const total = p.length * p.occurrences;
  // OVER and EVERY are one clause and never split across lines.
  return `${kw("OVER")} ${total} ${unitFor(total, p.type)} ${kw("EVERY")} ${p.length} ${unitFor(p.length, p.type)}`;
}

function toDocAmount(a: Amount): Doc {
  if (a.type === "QUANTITY") return String(a.value);
  // Omit the default 1/1 portion.
  if (a.numerator === 1 && a.denominator === 1) return "";
  return `${a.numerator}/${a.denominator}`;
}

export function toDocVestingNodeExpr(node: VestingNodeExpr): Doc {
  switch (node.type) {
    case "SINGLETON":
      return toDocVestingNode(node);
    case "EARLIER_OF":
    case "LATER_OF":
      return parenGroup(
        kw(node.type.replace("_", " ")),
        node.items.map(toDocVestingNodeExpr),
      );
  }
}

function toDocVestingNode(node: VestingNode): Doc {
  const parts: Doc[] = [];
  parts.push(toDocVestingBase(node.base));
  parts.push(toDocOffsets(node.offsets));
  if (node.condition) parts.push(toDocCondition(node.condition));
  return spaced(parts);
}

function toDocDuration(d: Duration): string {
  const sign = d.sign === "MINUS" ? "-" : "+";
  return `${sign}${d.value} ${unitFor(d.value, d.unit)}`;
}

function toDocCondition(node: Condition): Doc {
  switch (node.type) {
    case "ATOM":
      return toDocConstraint(node.constraint);
    case "AND":
    case "OR":
      return parenGroup(kw(node.type), node.items.map(toDocCondition));
  }
}

function toDocConstraint(c: Constraint): Doc {
  const parts: Doc[] = [];
  if (c.strict) parts.push(kw("STRICTLY"));
  parts.push(kw(c.type));
  parts.push(toDocVestingNode(c.base));
  return spaced(parts);
}

function toDocOffsets(offsets: Offsets): Doc {
  if (!offsets || offsets.length === 0) return "";
  return join(" ", offsets.map(toDocDuration));
}

function toDocVestingBase(base: VestingBase): Doc {
  return `${kw(base.type)} ${base.value}`;
}

/* ------------------------
 * Sugar collapse
 * ------------------------ */

function isDefaultVestingStart(vs: Schedule["vesting_start"]): boolean {
  if (vs.type !== "SINGLETON") return false;
  if (vs.base.type !== "EVENT") return false;
  if (vs.base.value !== "grantDate") return false;
  if (vs.offsets && vs.offsets.length > 0) return false;
  if (vs.condition) return false;
  return true;
}

/**
 * If `node` is exactly `EVENT <systemEvent> + <one positive duration>` with no
 * conditions, return the bare-duration text the grammar's sugar accepts
 * (`FROM 6 months` for `FROM EVENT grantDate + 6 months`, likewise for CLIFF).
 * Otherwise null, so the caller emits the full form.
 */
function sugaredAnchorDuration(
  node: VestingNodeExpr,
  systemEvent: "grantDate" | "vestingStart",
): string | null {
  if (node.type !== "SINGLETON") return null;
  if (node.base.type !== "EVENT") return null;
  if (node.base.value !== systemEvent) return null;
  if (node.condition) return null;
  if (!node.offsets || node.offsets.length !== 1) return null;
  const offset = node.offsets[0];
  if (offset.sign !== "PLUS") return null;
  return toDocDuration(offset).slice(1); // drop the leading '+'
}

/* ------------------------
 * Helpers
 * ------------------------ */

function kw(keyword: string): string {
  return keyword.toUpperCase();
}

/** Lowercase the period tag, singular when the magnitude is exactly 1. */
function unitFor(count: number, type: "MONTHS" | "DAYS"): string {
  const lower = type.toLowerCase();
  return Math.abs(count) === 1 ? lower.slice(0, -1) : lower;
}

/**
 * `KW(a, b)` when it fits; open paren, one item per indented line, close paren
 * when it doesn't. Its own group, so it breaks independently of its context.
 */
function parenGroup(keyword: Doc, items: Doc[]): Doc {
  return group([
    keyword,
    "(",
    indent([softline, join([",", line], items)]),
    softline,
    ")",
  ]);
}

function isEmpty(d: Doc): boolean {
  return d === "" || (Array.isArray(d) && d.length === 0);
}

/** Intersperse a single space between the non-empty parts. */
function spaced(parts: Doc[]): Doc {
  const out: Doc[] = [];
  for (const p of parts) {
    if (isEmpty(p)) continue;
    if (out.length > 0) out.push(" ");
    out.push(p);
  }
  return out;
}
