import type {
  Amount,
  ChainedSchedule,
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
import { selectorKeyword } from "@vestlang/utils";
import { systemAnchorOffset } from "@vestlang/walk";
import { group, indent, join, line, softline, type Doc } from "./doc.js";

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
 *
 * The per-node `switch`es below recurse the AST themselves rather than using the
 * shared `@vestlang/walk` traversal, and that's deliberate. This is a
 * paramorphism: the output depends on the *original* node, not just its
 * children — `isDefaultVestingStart` and `sugaredAnchorDuration` look at a
 * node's own fields to decide whether to drop or sugar a clause, which a fold
 * over children alone can't see. Each arm also emits a different `Doc` shape, so
 * a generic "visit every node" walk would buy nothing here.
 */
export function toDoc(node: Statement | Program): Doc {
  return Array.isArray(node) ? toDocProgram(node) : toDocStatement(node);
}

function toDocProgram(p: Program): Doc {
  if (p.length === 0) return "";
  if (p.length === 1) return toDocStatement(p[0]);

  // The flat statement list folds two structures together: a `chained` statement
  // continues the chain begun by the statement before it, and any other
  // statement opens a fresh one. Rebuild that grouping so the chains print with
  // THEN between their segments and PLUS between the chains.
  const chains: Statement[][] = [];
  for (const s of p) {
    if (s.chained && chains.length > 0) chains[chains.length - 1].push(s);
    else chains.push([s]);
  }

  return group(join([line, kw("PLUS"), " "], chains.map(toDocChain)));
}

/** One chain: its segments joined by THEN (or just the segment, if it stands alone). */
function toDocChain(segments: Statement[]): Doc {
  if (segments.length === 1) return toDocStatement(segments[0]);
  return group(join([line, kw("THEN"), " "], segments.map(toDocStatement)));
}

function toDocStatement(s: Statement): Doc {
  const head: Doc[] = [];
  const amount = toDocAmount(s.amount);
  if (!isEmpty(amount)) head.push(amount, " ");
  head.push(kw("VEST"));

  // A chained tail is always a plain single-schedule body (it just has no FROM
  // clause to emit), and a single-schedule head expands the same way. A selector
  // head is not a stanza — it rides next to VEST and breaks via its own
  // paren-group.
  if (s.chained) return stanza(head, scheduleClauses(s.expr));
  if (s.expr.type === "SCHEDULE") return stanza(head, scheduleClauses(s.expr));
  return group([...head, " ", toDocScheduleExpr(s.expr)]);
}

/** VEST on its own line, then each clause indented under it; collapses to one
 *  line when it fits. With no clauses, just the bare head. */
function stanza(head: Doc[], clauses: Doc[]): Doc {
  if (clauses.length === 0) return group(head);
  return group([head, indent(clauses.flatMap((c) => [line, c]))]);
}

function toDocScheduleExpr(e: ScheduleExpr): Doc {
  switch (e.type) {
    case "SCHEDULE":
      // Inline form (e.g. as a selector item): no stanza breaking.
      return spaced(scheduleClauses(e));
    case "SCHEDULE_LATER_OF":
    case "SCHEDULE_EARLIER_OF":
      return parenGroup(
        kw(selectorKeyword(e.type)),
        e.items.map(toDocScheduleExpr),
      );
  }
}

/**
 * The clauses of a singleton schedule, in grammar order: an optional FROM, the
 * cadence (OVER…EVERY, one unbreakable unit), and an optional CLIFF. Returned
 * as a list so the statement can lay them inline or one-per-line.
 */
function scheduleClauses(s: Schedule | ChainedSchedule): Doc[] {
  const clauses: Doc[] = [];

  // FROM clause:
  //   - a chained tail has no start (it continues from the prior segment), so
  //     there's nothing to emit
  //   - omit entirely if it's the default grantDate with no offsets/conditions
  //   - sugar `EVENT grantDate +N` back to the bare `FROM N` the grammar accepts
  if (s.vesting_start && !isDefaultVestingStart(s.vesting_start)) {
    const sugared = sugaredAnchorDuration(s.vesting_start, "GRANT_DATE");
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
    const sugared = sugaredAnchorDuration(s.periodicity.cliff, "VESTING_START");
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
    case "NODE":
      return toDocVestingNode(node);
    case "NODE_EARLIER_OF":
    case "NODE_LATER_OF":
      return parenGroup(
        kw(selectorKeyword(node.type)),
        node.items.map(toDocVestingNodeExpr),
      );
    default:
      // A normalized AST resolves cliffs/anchors to VestingNodeExpr nodes; a raw
      // vestlang_parse AST leaves a cliff as a bare DURATION, which has no
      // rendering here. Fail loudly rather than return undefined into the
      // printer, where it crashes deep in Doc traversal with "reading 'kind'".
      throw new Error(
        `Cannot render un-normalized node of type "${(node as { type: string }).type}"; ` +
          `toDoc expects the normalized AST (cliffs and anchors resolved to nodes), not a raw parse AST`,
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
  switch (base.type) {
    case "DATE":
      return `${kw("DATE")} ${base.value}`;
    case "EVENT":
      return `${kw("EVENT")} ${base.value}`;
    // System anchors print in the same `EVENT <name>` form they always have —
    // the grammar re-accepts `EVENT grantDate` / `EVENT vestingStart` and folds
    // them back to their tags, so the round-trip is stable.
    case "GRANT_DATE":
      return `${kw("EVENT")} grantDate`;
    case "VESTING_START":
      return `${kw("EVENT")} vestingStart`;
  }
}

/* ------------------------
 * Sugar collapse
 * ------------------------ */

function isDefaultVestingStart(vs: Schedule["vesting_start"]): boolean {
  if (vs.type !== "NODE") return false;
  if (vs.base.type !== "GRANT_DATE") return false;
  if (vs.offsets && vs.offsets.length > 0) return false;
  if (vs.condition) return false;
  return true;
}

/**
 * If `node` is exactly `<systemAnchor> + <one positive duration>` with no
 * conditions, return the bare-duration text the grammar's sugar accepts
 * (`FROM 6 months` for `FROM grantDate + 6 months`, likewise for CLIFF).
 * Otherwise null, so the caller emits the full form.
 */
function sugaredAnchorDuration(
  node: VestingNodeExpr,
  systemAnchor: "GRANT_DATE" | "VESTING_START",
): string | null {
  const offset = systemAnchorOffset(node, systemAnchor);
  if (!offset) return null;
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
