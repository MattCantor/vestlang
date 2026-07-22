// Firing-invariant contradiction analysis for a gate that pins both sides of a
// BEFORE/AFTER comparison to the *same* non-date anchor.
//
// The sibling date analysis in `window.ts` catches an empty *date* window
// (`AFTER 2026-01-01 AND BEFORE 2025-01-01`). Its event analog slips through
// there, because that module treats every event as "could fire on any date" and
// so contributes the full line. But a gate like `EVENT ipo STRICTLY AFTER EVENT
// ipo` is impossible no matter *when* `ipo` fires: the shared anchor cancels and
// what's left is a fixed comparison of the two sides' offsets. That's the class
// this module decides.
//
// "Same anchor" means same non-date symbol with a stable identity: an event by
// name, or one of the two system anchors (grant date / vesting start). Fixed
// dates are excluded — they keep routing through `window.ts`.
//
// Soundness floor: this may only ever *under*-report. It never flags a gate that
// is actually satisfiable. Whenever the offset ordering can't be settled without
// committing to month lengths (a mixed-sign month+day delta), it abstains.

import type {
  Condition,
  Constraint,
  ConstraintTag,
  Offsets,
  VestingBase,
  VestingNode,
} from "@vestlang/types";
import { assertNever } from "@vestlang/utils";

/* ------------------------
 * Offset delta sign
 * ------------------------ */

// The ordering of one offset delta against zero. An offset is at most one MONTHS
// term and one DAYS term, so a delta collapses to a single signed month count and
// a single signed day count — and its sign is knowable *without* a day-of-month
// policy exactly when the two components agree in direction.
export type OffsetSign = "ZERO" | "POSITIVE" | "NEGATIVE" | "INDETERMINATE";

// Classify a delta given as net signed months and net signed days.
//
// A positive number of months always moves strictly forward under any policy (a
// month is at least 28 days), and a positive number of days likewise — so a
// same-signed month+day delta has a determinate sign. A mixed-sign delta (say +1
// month and −29 days) can land either way depending on the month it's applied in,
// so it can't be ordered statically: abstain.
export const classifyOffsetDelta = (
  netMonths: number,
  netDays: number,
): OffsetSign => {
  if (netMonths === 0 && netDays === 0) return "ZERO";
  if (netMonths >= 0 && netDays >= 0) return "POSITIVE";
  if (netMonths <= 0 && netDays <= 0) return "NEGATIVE";
  return "INDETERMINATE";
};

// When is `S REL operand` *determinately false*, given the sign of `operand − S`?
// Both sides share the anchor, so the comparison is just the two offsets:
//   AFTER  means S ≥ operand (strict: S > operand) — false once operand is ahead.
//   BEFORE means S ≤ operand (strict: S < operand) — false once operand is behind.
// A strict relation additionally fails on a tie (a zero delta). An indeterminate
// delta never counts as determinately false, so the caller abstains on it.
export const isReflexiveContradiction = (
  rel: ConstraintTag,
  strict: boolean,
  sign: OffsetSign,
): boolean => {
  switch (rel) {
    case "AFTER":
      return strict
        ? sign === "POSITIVE" || sign === "ZERO"
        : sign === "POSITIVE";
    case "BEFORE":
      return strict
        ? sign === "NEGATIVE" || sign === "ZERO"
        : sign === "NEGATIVE";
    default:
      return assertNever(rel);
  }
};

/* ------------------------
 * Anchor identity & offsets
 * ------------------------ */

interface NetOffset {
  months: number;
  days: number;
}

// Reduce an offset sequence to its net signed months and days. `PLUS`/`MINUS` set
// the sign; a magnitude and a unit set the term. At most one of each unit appears
// (the grammar allows `[]`, `[month|day]`, or `[month, day]`), so summing is a
// formality that also keeps this total over any ordering.
const netOffset = (offsets: Offsets): NetOffset => {
  let months = 0;
  let days = 0;
  for (const o of offsets) {
    const signed = o.value * (o.sign === "PLUS" ? 1 : -1);
    if (o.unit === "MONTHS") months += signed;
    else days += signed;
  }
  return { months, days };
};

// A stable key for a non-date anchor, or undefined when there's no firing-invariant
// symbol to key on. Two anchors are "the same" iff they produce the same key: an
// event matches only an event of the same name; the two system anchors each match
// only themselves. A DATE has no symbol (it's a fixed point `window.ts` owns), so
// it keys to undefined and drops out of this analysis.
const anchorKey = (base: VestingBase): string | undefined => {
  switch (base.type) {
    case "EVENT":
      return `EVENT:${base.value}`;
    case "GRANT_DATE":
      return "GRANT_DATE";
    case "VESTING_START":
      return "VESTING_START";
    case "DATE":
      return undefined;
    default:
      return assertNever(base);
  }
};

// The operand of a gate atom, reduced to (anchor key, net offset) when it's a bare
// same-anchor symbol we can cancel against the subject. A gate reference that
// carries its *own* condition isn't a plain anchor — its date depends on that
// nested gate — so it's excluded; likewise a DATE operand (undefined key).
interface AnchorOperand {
  key: string;
  offset: NetOffset;
}

const anchorOperand = (node: VestingNode): AnchorOperand | undefined => {
  if (node.condition) return undefined;
  const key = anchorKey(node.base);
  return key === undefined
    ? undefined
    : { key, offset: netOffset(node.offsets) };
};

/* ------------------------
 * Conjunctive core
 * ------------------------ */

// The gate's OR-free conjunctive core: flatten nested ANDs and collect their
// atoms' constraints, but stop at any OR. A contradictory arm *under* an OR
// doesn't kill the gate (a live sibling arm can still satisfy it), so nothing
// inside an OR subtree is analyzed. A lone ATOM is a one-atom core.
const conjunctiveConstraints = (c: Condition): Constraint[] => {
  switch (c.type) {
    case "ATOM":
      return [c.constraint];
    case "AND":
      return c.items.flatMap(conjunctiveConstraints);
    case "OR":
      return [];
    default:
      return assertNever(c);
  }
};

/* ------------------------
 * The two checks
 * ------------------------ */

// Reflexive point check. When an atom's operand is the *enclosing node's own*
// anchor, the atom reduces to a bare comparison of the two sides' offsets. Flag
// when that comparison is determinately false.
const hasReflexiveContradiction = (
  node: VestingNode,
  constraints: Constraint[],
): boolean => {
  const subjectKey = anchorKey(node.base);
  if (subjectKey === undefined) return false;
  const subject = netOffset(node.offsets);
  return constraints.some((c) => {
    const op = anchorOperand(c.base);
    if (!op || op.key !== subjectKey) return false;
    // delta = offsets_operand − offsets_subject.
    const sign = classifyOffsetDelta(
      op.offset.months - subject.months,
      op.offset.days - subject.days,
    );
    return isReflexiveContradiction(c.type, c.strict, sign);
  });
};

interface Bound {
  offset: NetOffset;
  strict: boolean;
}

// One AFTER (lower) bound against one BEFORE (upper) bound on the shared unknown
// `d = subject − operand`: both bounds carry the subject's offset, which cancels,
// so what's left is comparing the two operands' offsets. The window is empty when
// the lower bound sits determinately above the upper one, or when they coincide
// and a strict edge excludes the single shared point.
const windowEmpty = (after: Bound, before: Bound): boolean => {
  const sign = classifyOffsetDelta(
    before.offset.months - after.offset.months,
    before.offset.days - after.offset.days,
  );
  if (sign === "NEGATIVE") return true; // lower bound past the upper bound
  if (sign === "ZERO") return after.strict || before.strict; // point, edge excluded
  return false; // POSITIVE leaves room; INDETERMINATE abstains
};

// Same-operand empty-window check. Group the collected atoms by operand symbol;
// within a group every AFTER is a lower bound and every BEFORE an upper bound on
// the same unknown. Any AFTER×BEFORE pair whose window is determinately empty
// kills the gate. (One AFTER + one BEFORE is the confirmed shape; checking all
// pairs keeps it right for larger groups.)
const hasEmptyWindow = (constraints: Constraint[]): boolean => {
  const lowers = new Map<string, Bound[]>();
  const uppers = new Map<string, Bound[]>();
  for (const c of constraints) {
    const op = anchorOperand(c.base);
    if (!op) continue;
    const into = c.type === "AFTER" ? lowers : uppers;
    const bounds = into.get(op.key) ?? [];
    bounds.push({ offset: op.offset, strict: c.strict });
    into.set(op.key, bounds);
  }
  for (const [key, afters] of lowers) {
    const befores = uppers.get(key);
    if (!befores) continue;
    for (const a of afters)
      for (const b of befores) if (windowEmpty(a, b)) return true;
  }
  return false;
};

/* ------------------------
 * Public API
 * ------------------------ */

// The two verdicts a same-anchor gate can carry, kept apart so the linter can
// report each at its own path (reflexive at the node, empty-window at the
// condition). A gate can in principle trip both.
export interface SameAnchorGate {
  reflexive: boolean;
  emptyWindow: boolean;
}

// Analyze a node's gate for a same-anchor contradiction over its conjunctive core.
// A gateless node — or one whose only atoms live under an OR — is clean.
export const analyzeSameAnchorGate = (node: VestingNode): SameAnchorGate => {
  if (!node.condition) return { reflexive: false, emptyWindow: false };
  const constraints = conjunctiveConstraints(node.condition);
  return {
    reflexive: hasReflexiveContradiction(node, constraints),
    emptyWindow: hasEmptyWindow(constraints),
  };
};

// The headline question for the evaluator: is this node's gate impossible no
// matter what fires? True when either check flags it.
export const isSameAnchorImpossible = (node: VestingNode): boolean => {
  const { reflexive, emptyWindow } = analyzeSameAnchorGate(node);
  return reflexive || emptyWindow;
};
