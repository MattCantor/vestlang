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

// One contiguous date range: an inclusive-or-strict lower and/or upper edge.
// A missing side is unbounded in that direction. (Half-line when one side is
// absent, both-bounded when neither is, the full line when both are.)
interface Window {
  lower?: Bound;
  upper?: Bound;
}

// A condition's satisfiable dates as a union of disjoint ranges, kept sorted by
// lower edge (earliest first). The empty array means *no* date satisfies the
// condition; a one-element [{}] is the full line. Intersection (AND) and union
// (OR) both preserve the sorted-disjoint invariant, so the set stays linear in
// the atom count rather than exploding into the DNF cross-product.
type IntervalSet = Window[];

// A node is statically datable only when it's a plain fixed DATE — no offsets
// (month offsets resolve through a runtime day-of-month policy, so they aren't
// datable without committing to a policy lint doesn't own) and no condition of
// its own (a gated anchor isn't a fixed point either).
const staticDate = (n: VestingNode): OCTDate | undefined =>
  n.base.type === "DATE" && n.offsets.length === 0 && n.condition === undefined
    ? n.base.value
    : undefined;

// Lower-edge order: the *later* date is the tighter (higher) lower bound, and on
// a tie the strict edge ranks above the inclusive one — it starts the day after.
// Returns negative when `a` is the looser (earlier-starting) bound. Plain string
// `<`/`>` is calendar order on ISO YYYY-MM-DD.
const compareLower = (a: Bound, b: Bound): number =>
  a.date !== b.date
    ? a.date < b.date
      ? -1
      : 1
    : Number(a.strict) - Number(b.strict);

// Upper-edge order: the *earlier* date is the tighter (lower) upper bound, strict
// again ranking tighter on a tie. Returns negative when `a` is the looser
// (later-ending) bound.
const compareUpper = (a: Bound, b: Bound): number =>
  a.date !== b.date
    ? a.date < b.date
      ? 1
      : -1
    : Number(a.strict) - Number(b.strict);

// Tighten `a` against `b`: keep the higher lower edge and the lower upper edge.
// Used for the no-OR fold (and the running merge in the sweep), where every
// conjunct narrows a single window.
const intersect = (a: Window, b: Window): Window => {
  const lower =
    a.lower && b.lower
      ? compareLower(a.lower, b.lower) >= 0
        ? a.lower
        : b.lower
      : (a.lower ?? b.lower);
  const upper =
    a.upper && b.upper
      ? compareUpper(a.upper, b.upper) >= 0
        ? a.upper
        : b.upper
      : (a.upper ?? b.upper);
  return { lower, upper };
};

// Exact at day granularity. Both bounds present and the span between them too
// small to hold a satisfiable date: equal non-strict bounds are a one-day window
// (fine); equal bounds with any strict side, or adjacent days strict on both,
// leave nothing. A half-line (one edge missing) is never empty.
const isEmpty = (w: Window): boolean =>
  w.lower !== undefined &&
  w.upper !== undefined &&
  daysBetween(w.lower.date, w.upper.date) <
    (w.lower.strict ? 1 : 0) + (w.upper.strict ? 1 : 0);

// Does a single window admit any date? The inverse of `isEmpty` — pulled out so
// the sweep and union read declaratively.
const nonEmpty = (w: Window): boolean => !isEmpty(w);

// Sort an interval list by lower edge, then collapse overlapping or touching
// ranges into one. "Touching" is strictness-aware: `(.., d] ∪ [d, ..)` covers
// the shared day `d` and merges, but `(.., d) ∪ (d, ..)` leaves a hole at `d`
// and stays two intervals. The day-granularity rule lives in `isEmpty`: the gap
// between a left range's upper and a right range's lower closes exactly when
// their intersection would *not* be empty.
const union = (a: IntervalSet, b: IntervalSet): IntervalSet => {
  const sorted = [...a, ...b].sort((x, y) => {
    // Unbounded-below sorts first; otherwise by lower edge.
    if (!x.lower) return y.lower ? -1 : 0;
    if (!y.lower) return 1;
    return compareLower(x.lower, y.lower);
  });

  const merged: Window[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    // The two ranges leave a hole only when an inclusive-or-strict gap sits
    // between them: `last.upper` strictly precedes `w.lower` with no shared day.
    // `intersect`-then-`isEmpty` on the boundary captures exactly that — if the
    // overlap of [.., last.upper] and [w.lower, ..] is non-empty, they touch.
    if (last && (!last.upper || !w.lower || touches(last.upper, w.lower))) {
      // Extend `last` to the looser upper edge (an unbounded upper swallows the
      // rest). The lower edge is already the earlier one by sort order.
      last.upper =
        last.upper && w.upper
          ? compareUpper(last.upper, w.upper) <= 0
            ? last.upper
            : w.upper
          : undefined;
    } else {
      merged.push({ ...w });
    }
  }
  return merged;
};

// Two adjacent ranges touch when a single window spanning [.., upper] and
// [lower, ..] would still admit a date — i.e. the upper edge reaches the lower
// edge under the same day-granularity rule the rest of the file uses.
const touches = (upper: Bound, lower: Bound): boolean =>
  nonEmpty({ lower, upper });

// Intersect two sorted-disjoint sets with a single linear sweep: walk both with
// one pointer each, emit the overlap of the current pair, then advance whichever
// range ends first (it can't overlap anything later). Output is sorted-disjoint
// and bounded by m + n − 1 — no cross-product, so an AND of disjoint-arm ORs
// stays linear instead of doubling per conjunct.
const intersectSets = (a: IntervalSet, b: IntervalSet): IntervalSet => {
  const out: Window[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const overlap = intersect(a[i], b[j]);
    if (nonEmpty(overlap)) out.push(overlap);

    // Advance the range whose upper edge comes first; it cannot meet any later
    // range in the other set. An unbounded upper never ends first.
    const au = a[i].upper;
    const bu = b[j].upper;
    if (!au) {
      j++;
    } else if (!bu) {
      i++;
    } else if (compareUpper(au, bu) >= 0) {
      // `a[i]` ends no later than `b[j]` (tighter or equal upper) — retire it.
      i++;
    } else {
      j++;
    }
  }
  return out;
};

// Map a constraint to its satisfiable set, matching the evaluator's
// failByRelation semantics: bare AFTER/BEFORE are non-strict (>=/<=), STRICTLY
// makes them strict (>/<). AND intersects, OR unions; an anchor we can't
// statically date contributes the full line `[{}]`, which keeps the rule sound —
// it can only under-report, never false-positive on something still satisfiable.
const satisfiableSet = (c: Condition): IntervalSet => {
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
      return c.items.reduce<IntervalSet>(
        (acc, item) => intersectSets(acc, satisfiableSet(item)),
        [{}],
      );
    case "OR":
      return c.items.reduce<IntervalSet>(
        (acc, item) => union(acc, satisfiableSet(item)),
        [],
      );
    default:
      return assertNever(c);
  }
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
        // the anchor sits in the set iff some range admits it.
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
