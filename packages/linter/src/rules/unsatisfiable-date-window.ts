import { daysBetween } from "@vestlang/core";
import { assertNever } from "@vestlang/utils";
import type { Condition, OCTDate, VestingNode } from "@vestlang/types";
import { RuleModule } from "../types.js";

const meta = {
  id: "unsatisfiable-date-window",
  description:
    "BEFORE/AFTER constraints over fixed dates must leave at least one satisfiable date; an empty window can never be met, so the gated node can never resolve.",
  recommended: true,
  severity: "error" as const,
};

interface Bound {
  date: OCTDate;
  strict: boolean;
}

// One conjunctive date window: an inclusive-or-strict lower and/or upper edge.
// A missing side is unbounded in that direction.
interface Window {
  lower?: Bound;
  upper?: Bound;
}

// A node is statically datable only when it's a plain fixed DATE — no offsets
// (month offsets resolve through a runtime day-of-month policy, so they aren't
// datable without committing to a policy lint doesn't own) and no condition of
// its own (a gated anchor isn't a fixed point either).
const staticDate = (n: VestingNode): OCTDate | undefined =>
  n.base.type === "DATE" && n.offsets.length === 0 && n.condition === undefined
    ? n.base.value
    : undefined;

// Tighten `a` against `b`. Lower edge: the later date wins, and on a tie the
// strict one (it excludes its own day, so it's the stronger bound). Upper edge:
// the earlier date wins, strict winning ties for the same reason. Plain string
// `<`/`>` is calendar order on ISO YYYY-MM-DD.
const intersect = (a: Window, b: Window): Window => {
  const lowers = [a.lower, b.lower].filter((x): x is Bound => x !== undefined);
  const uppers = [a.upper, b.upper].filter((x): x is Bound => x !== undefined);

  const lower = lowers.reduce<Bound | undefined>((acc, cur) => {
    if (!acc) return cur;
    if (cur.date > acc.date) return cur;
    if (cur.date === acc.date && cur.strict) return cur;
    return acc;
  }, undefined);

  const upper = uppers.reduce<Bound | undefined>((acc, cur) => {
    if (!acc) return cur;
    if (cur.date < acc.date) return cur;
    if (cur.date === acc.date && cur.strict) return cur;
    return acc;
  }, undefined);

  return { lower, upper };
};

// Map one constraint to a window, matching the evaluator's failByRelation
// semantics exactly: bare AFTER/BEFORE are non-strict (>=/<=); STRICTLY makes
// them strict (>/<). An anchor we can't statically date contributes nothing —
// the unbounded window — which keeps the rule sound: it can only under-report,
// never false-positive on something that might still be satisfiable.
const windowsOf = (c: Condition): Window[] => {
  switch (c.type) {
    case "ATOM": {
      const { constraint } = c;
      const date = staticDate(constraint.base);
      if (date === undefined) return [{}];
      const bound: Bound = { date, strict: constraint.strict };
      return constraint.type === "AFTER"
        ? [{ lower: bound }]
        : [{ upper: bound }];
    }
    case "AND":
      // Cross-product the conjuncts: every combination of one window per item,
      // intersected. (A single conjunct's windowsOf is a one-element list unless
      // it nests an OR.)
      return c.items.reduce<Window[]>(
        (acc, item) => {
          const ws = windowsOf(item);
          return acc.flatMap((w) => ws.map((x) => intersect(w, x)));
        },
        [{}],
      );
    case "OR":
      return c.items.flatMap(windowsOf);
    default:
      return assertNever(c);
  }
};

// Exact at day granularity. Both bounds present and the span between them too
// small to hold a satisfiable date: equal non-strict bounds are a one-day window
// (fine); equal bounds with any strict side, or adjacent days strict on both,
// leave nothing.
const isEmpty = (w: Window): boolean =>
  w.lower !== undefined &&
  w.upper !== undefined &&
  daysBetween(w.lower.date, w.upper.date) <
    (w.lower.strict ? 1 : 0) + (w.upper.strict ? 1 : 0);

// Render a both-bounded window in words for the single-window message. Only
// ever called on an empty window, which by construction has both edges.
const describe = (w: Window): string =>
  `${w.lower!.strict ? "strictly after" : "on or after"} ${w.lower!.date} and ${
    w.upper!.strict ? "strictly before" : "on or before"
  } ${w.upper!.date}`;

export const ruleUnsatisfiableDateWindow: RuleModule = {
  meta,
  create(ctx) {
    const { id, severity } = meta;
    return {
      // Every gated node — start, cliff, selector arm, or a constraint's own
      // reference anchor — surfaces as a NODE in the shared walk, so this one
      // hook covers them all.
      NODE(node, path) {
        if (!node.condition) return;
        const windows = windowsOf(node.condition);

        // No date satisfies any alternative: the gate is dead.
        if (windows.every(isEmpty)) {
          ctx.report({
            ruleId: id,
            severity,
            path: path.concat("condition"),
            message:
              windows.length === 1
                ? `this gate's date window is empty: no date is ${describe(windows[0])}`
                : "this gate's date window is empty: every OR alternative pins dates to an empty range",
          });
          return;
        }

        // The window can hold *some* date, but if this node's own anchor is a
        // fixed date, check that the anchor itself lands inside it — a fixed
        // start outside its gate can never satisfy the gate.
        const d =
          node.base.type === "DATE" && node.offsets.length === 0
            ? node.base.value
            : undefined;
        if (d === undefined) return;
        const seed: Window = {
          lower: { date: d, strict: false },
          upper: { date: d, strict: false },
        };
        if (windows.map((w) => intersect(w, seed)).every(isEmpty)) {
          ctx.report({
            ruleId: id,
            severity,
            path,
            message: `anchor date ${d} falls outside this gate's date window; the gate can never be satisfied`,
          });
        }
      },
    };
  },
};
