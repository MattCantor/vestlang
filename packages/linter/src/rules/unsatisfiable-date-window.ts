import {
  intersect,
  nonEmpty,
  satisfiableSet,
  type Window,
} from "@vestlang/primitives";
import { assertNever } from "@vestlang/utils";
import type { Condition } from "@vestlang/types";
import { RuleModule } from "../types.js";

const meta = {
  id: "unsatisfiable-date-window",
  description:
    "BEFORE/AFTER constraints over fixed dates must leave at least one satisfiable date; an empty window can never be met, so the gated node can never resolve.",
  recommended: true,
  severity: "error" as const,
};

// True when an OR appears anywhere in the condition. Without one, the whole
// condition folds to a single window (no DNF), and an empty result can be named
// concretely; with one, the empty result is "every alternative is dead" and the
// detailed message no longer has two bounds to quote. Mirrors the old
// `windows.length === 1` split exactly.
const hasOr = (c: Condition): boolean => {
  switch (c.type) {
    case "ATOM":
      return false;
    case "AND":
    case "OR":
      return c.type === "OR" || c.items.some(hasOr);
    default:
      return assertNever(c);
  }
};

// Fold an OR-free condition into the single window its atoms tighten down to.
// Safe to call only when `hasOr(c)` is false — it ignores OR entirely. O(atoms),
// no cross-product, so it can't blow up.
const foldWindow = (c: Condition): Window => {
  switch (c.type) {
    case "ATOM": {
      const set = satisfiableSet(c);
      return set[0] ?? {};
    }
    case "AND":
      return c.items.reduce<Window>(
        (acc, item) => intersect(acc, foldWindow(item)),
        {},
      );
    case "OR":
      // The only caller guards on `!hasOr`, and the recursion only descends
      // through AND, so an OR can't be reached here. Fail loudly if that ever
      // changes rather than silently widening to the full line.
      throw new Error("foldWindow reached an OR — caller must guard on !hasOr");
    default:
      return assertNever(c);
  }
};

// Render a both-bounded window in words for the single-window message. Only ever
// called on an empty window, which by construction has both edges.
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
        const condition = node.condition;
        const set = satisfiableSet(condition);

        // No date satisfies any alternative: the gate is dead. Branch on
        // structure for the message — an OR-free condition has one nameable
        // window, an OR-bearing one collapsed every alternative to nothing.
        if (set.length === 0) {
          ctx.report({
            ruleId: id,
            severity,
            path: path.concat("condition"),
            message: hasOr(condition)
              ? "this gate's date window is empty: every OR alternative pins dates to an empty range"
              : `this gate's date window is empty: no date is ${describe(foldWindow(condition))}`,
          });
          return;
        }

        // The window can hold *some* date, but if this node's own anchor is a
        // fixed date, check that the anchor itself lands inside it — a fixed
        // start outside its gate can never satisfy the gate. Point-containment:
        // the anchor sits in the set iff some range admits it. (This branch stays
        // linter-only: the evaluator's per-operand path already catches a fixed
        // anchor outside its window.)
        const d =
          node.base.type === "DATE" && node.offsets.length === 0
            ? node.base.value
            : undefined;
        if (d === undefined) return;
        const point: Window = {
          lower: { date: d, strict: false },
          upper: { date: d, strict: false },
        };
        if (!set.some((w) => nonEmpty(intersect(w, point)))) {
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
