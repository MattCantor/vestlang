import {
  Anchor,
  ASTExpr,
  ASTSchedule,
  ASTStatement,
  DateAnchor,
  Duration,
  EventAnchor,
  FromTerm,
  QualifiedAnchor,
  TemporalPredNode,
} from "@vestlang/dsl";
import {
  BoundCandidate,
  EarlierOfSchedules,
  EarlierOfVestingStart,
  EndWindow,
  Expr,
  LaterOfSchedules,
  LaterOfVestingStart,
  Periodicity,
  PeriodicityInDays,
  PeriodicityInMonths,
  Schedule,
  StartWindow,
  Statement,
  VestingStart,
  VestingStartDate,
  VestingStartEvent,
  VestingStartExpr,
  VestingStartQualified,
  Window,
} from "./types/normalized.js";
import {
  isAnchor,
  isDuration,
  isEarlierOfFrom,
  isEarlierOfSchedules,
  isEvent,
  isLaterOfFrom,
  isLaterOfSchedules,
  isQualifiedAnchor,
  isSchedule,
  isTwoOrMore,
  toTwoOrMore,
  isDate,
} from "./types/raw-ast-guards.js";
import { invariant, NormalizerError, unexpectedAst } from "./errors.js";
import { Amount, ExprType, Integer, TwoOrMore } from "./types/shared.js";
import { Numeric } from "./types/oct-types.js";

/* ------------------------
 * Public API
 * ------------------------ */

export function normalizeStatement(ast: ASTStatement): Statement {
  const expr = normalizeExpr(ast.expr, ["expr"]);
  const amount = normalizeAmount(ast.amount, ["amount"]);
  return {
    id: "",
    amount,
    expr,
  };
}

export function normalizeExpr(ast: ASTExpr, path: string[] = []): Expr {
  if (isSchedule(ast)) {
    return normalizeSchedule(ast, [...path, "Schedule"]);
  }

  if (isLaterOfSchedules(ast)) {
    const items = ast.items.map((e, i) =>
      normalizeExpr(e, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "LaterOfSchedules requires >= 2 items",
      { items },
      path,
    );
    return {
      id: "",
      type: "LaterOfSchedules" as ExprType,
      items: items as TwoOrMore<Expr>,
    } as LaterOfSchedules;
  }

  if (isEarlierOfSchedules(ast)) {
    const items = ast.items.map((e, i) =>
      normalizeExpr(e, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "EarlierOfSchedules requires >= 2 items",
      { items },
      path,
    );
    return {
      id: "",
      type: "EarlierOfSchedules" as ExprType,
      items: items as TwoOrMore<Expr>,
    } as EarlierOfSchedules;
  }
  return unexpectedAst("Unknown ASTExpr variant", { ast }, path);
}

/* ------------------------
 * Schedule
 * ------------------------ */

function normalizeSchedule(ast: ASTSchedule, path: string[]): Schedule {
  // Vesting start: FROM (may include combinators)
  const baseStart = normalizeFromTermOrDefault(ast.from, [...path, "from"]);

  // Periodicity: OVER / EVERY
  const periodicity = normalizePeriodicity(ast.over, ast.every, [
    ...path,
    "periodicity",
  ]);

  // Cliff
  const vestingStart = foldCliffIntoStart(baseStart, ast.cliff, periodicity, [
    ...path,
    "cliff",
  ]);

  return {
    id: "",
    type: "Schedule",
    vesting_start: vestingStart,
    periodicity,
  };
}

/* ------------------------
 * Amount
 * ------------------------ */

function normalizeAmount(astAmount: any, path: string[]): Amount {
  if (astAmount?.type === "AmountAbsolute") {
    invariant(
      typeof astAmount.value === "number",
      "AmountAbsolute.value must be a number",
      { value: astAmount.value },
      path,
    );
    return {
      type: "AmountAbsolute",
      value: astAmount.value,
    };
  }

  if (astAmount?.type === "AmountPercent") {
    const v = astAmount.value;

    invariant(
      typeof v === "number" && Number.isFinite(v),
      "AmountPercent.value must be a finite number",
      { value: v },
      path,
    );
    if (v >= 0 && v <= 1) {
      return {
        type: "AmountPercent",
        numerator: String(v * 100) as Numeric,
        denominator: "100" as Numeric,
      };
    }
    if (v > 1 && v <= 100) {
      return {
        type: "AmountPercent",
        numerator: String(v) as Numeric,
        denominator: "100" as Numeric,
      };
    }
    return unexpectedAst(
      "AmountPercent.value must be iether a fraction [0,1] or a percentage (1..100],",
      { value: v },
      path,
    );
  }
  // allow idempotency if a normalized version is ever passed in
  if (
    astAmount?.type === "AmountPercent" &&
    "numerator" in astAmount &&
    "denominator" in astAmount
  ) {
    return {
      type: "AmountPercent",
      numerator: astAmount.numerator as Numeric,
      denominator: astAmount.denominator as Numeric,
    };
  }
  return unexpectedAst("Unknown Amount variant", { astAmount }, path);
}

/* ------------------------
 * FROM -> VestingStartExpr
 * ------------------------ */

function normalizeFromTermOrDefault(
  from: FromTerm | undefined,
  path: string[],
): VestingStartExpr {
  if (!from) {
    const grant: EventAnchor = { type: "Event", value: "grantDate" };
    return makeUnqualifiedStart(grant);
  }
  return normalizeFromTerm(from, path);
}

function normalizeFromTerm(from: FromTerm, path: string[]): VestingStartExpr {
  if (isAnchor(from)) {
    return makeUnqualifiedStart(from);
  }

  if (isQualifiedAnchor(from)) {
    return makeQualifiedStart(from);
  }

  if (isEarlierOfFrom(from)) {
    const items = from.items.map((it, i) =>
      normalizeFromTerm(it, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "EarlierOf FROM requires >= 2 items",
      { items },
      path,
    );
    return {
      id: "",
      type: "EarlierOf",
      items: items as TwoOrMore<VestingStartExpr>,
    } satisfies EarlierOfVestingStart;
  }

  if (isLaterOfFrom(from)) {
    const items = from.items.map((it, i) =>
      normalizeFromTerm(it, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "LaterOf fROM requires >= 2 items",
      { items },
      path,
    );
    return {
      id: "",
      type: "LaterOf",
      items: items as TwoOrMore<VestingStartExpr>,
    } satisfies LaterOfVestingStart;
  }
  return unexpectedAst("Unknown FromTerm variant", { from }, path);
}

function makeUnqualifiedStart(a: Anchor): VestingStart {
  if (isDate(a)) {
    return <VestingStartDate>{
      id: "",
      type: "Unqualified",
      anchor: a,
      window: undefined,
    };
  }
  if (isEvent(a)) {
    return <VestingStartEvent>{
      id: "",
      type: "Unqualified",
      anchor: a,
      window: undefined,
    };
  }
  return unexpectedAst("Anchor must be Date or Event", { a });
}

function makeQualifiedStart(q: QualifiedAnchor): VestingStartQualified {
  const window = lowerPredicatesToWindow(q.predicates);
  return {
    id: "",
    type: "Qualified",
    anchor: q.base,
    window,
  };
}

/* ------------------------
 * Cliff folding
 * ------------------------ */

function foldCliffIntoStart(
  start: VestingStartExpr,
  cliff: any | undefined,
  periodicity: Periodicity,
  path: string[],
): VestingStartExpr {
  if (!cliff) return start;

  // Time-based cliff -> Periodicity.cliff
  if (isDuration(cliff)) {
    invariant(
      unitOfPeriodicity(periodicity) === cliff.unit,
      "Cliff duration unit must match periodicity",
      { periodicity, cliff },
      path,
    );
    const n = cliff.value as Integer;
    (periodicity as any).cliff = n;
    return start;
  }

  // Anchor/qualified/combinator -> LaterOf(start, cliffExpr)
  const cliffExpr = normalizeCliffToVestingStartExpr(cliff, [...path, "cliff"]);

  return makeLaterOfPair(start, cliffExpr);
}

function normalizeCliffToVestingStartExpr(
  x: any,
  path: string[],
): VestingStartExpr {
  if (isAnchor(x)) return makeUnqualifiedStart(x);
  if (isQualifiedAnchor(x)) return makeQualifiedStart(x);

  if (isEarlierOfFrom(x)) {
    const items = x.items.map((it: FromTerm, i) =>
      normalizeCliffToVestingStartExpr(it, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "EarlierOf cliff requires >= 2 items",
      { items },
      path,
    );
    return {
      id: "",
      type: "EarlierOf",
      items: items as TwoOrMore<VestingStartExpr>,
    };
  }

  if (isLaterOfFrom(x)) {
    const items = x.items.map((it: FromTerm, i) =>
      normalizeCliffToVestingStartExpr(it, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "LaterOf cliff requires >= 2 items",
      { items },
      path,
    );
    return {
      id: "",
      type: "LaterOf",
      items: items as TwoOrMore<VestingStartExpr>,
    };
  }

  return unexpectedAst("Unsupported cliff variant", { x }, path);
}

function makeLaterOfPair(
  a: VestingStartExpr,
  b: VestingStartExpr,
): VestingStartExpr {
  return {
    id: "",
    type: "LaterOf",
    items: [a, b],
  };
}

/* ------------------------
 * Windows from predicates
 * ------------------------ */

/**
 * Reduce a list of temporal predicates (AFTER / BEFORE / BETWEEN)
 * into a Window with candidate lists for start (LaterOf) and end (EarlierOf).
 * - We DO NOT discard incomparable anchors (events vs dates). We keep all candidates.
 * - If all candidates are Dates, we collapse immediately (safe).
 */
export function lowerPredicatesToWindow(preds: TemporalPredNode[]): Window {
  const startCandidates: BoundCandidate[] = [];
  const endCandidates: BoundCandidate[] = [];

  for (const p of preds) {
    switch (p.type) {
      case "After": {
        startCandidates.push({ at: p.i, inclusive: !p.strict });
        break;
      }
      case "Before": {
        endCandidates.push({ at: p.i, inclusive: !p.strict });
        break;
      }
      case "Between": {
        startCandidates.push({ at: p.a, inclusive: !p.strict });
        endCandidates.push({ at: p.b, inclusive: !p.strict });
        break;
      }
      default: {
        // Exhaustiveness guard (compile-time via never) can live elsewhere.
      }
    }
  }

  const start = makeStartWindow(startCandidates);
  const end = makeEndWindow(endCandidates);

  // Optional, non-lossy simplification: collapse only if *all* are Dates
  const simplifiedStart = maybeCollapseStartIfAllDates(start);
  const simplifiedEnd = maybeCollapseEndIfAllDates(end);

  // If both are fully dated singletons, sanity-check emptiness
  if (simplifiedStart && simplifiedEnd) {
    const s = simplifiedStart.candidates[0];
    const e = simplifiedEnd.candidates[0];
    if (isDate(s.at) && isDate(e.at)) {
      if (s.at.value > e.at.value) {
        throw new NormalizerError(
          "EMPTY_WINDOW_AFTER_RESOLVE",
          "Window normalization produced start > end",
          { start: simplifiedStart, end: simplifiedEnd },
        );
      }
      if (s.at.value === e.at.value && (!s.inclusive || !e.inclusive)) {
        throw new NormalizerError(
          "EMPTY_WINDOW_AFTER_RESOLVE",
          "Window normalization produced empty interval on equal exclusive bounds",
          { start: simplifiedStart, end: simplifiedEnd },
        );
      }
    }
  }

  return {
    start: simplifiedStart ?? start ?? undefined,
    end: simplifiedEnd ?? end ?? undefined,
  };
}

/** Build a StartWindow (LaterOf) from candidates; retain all candidates. */
function makeStartWindow(cands: BoundCandidate[]): StartWindow | undefined {
  if (cands.length === 0) return undefined;

  const candidates = toTwoOrMore(
    cands as [BoundCandidate, ...BoundCandidate[]],
  );
  invariant(
    isTwoOrMore(candidates),
    "StartWindow requires >= 1 candidate (TwoOrMore enforced)",
  );
  return { combine: "LaterOf" as const, candidates };
}

/** Build an EndWindow (EarlierOf) from candidates; retain all candidates. */
function makeEndWindow(cands: BoundCandidate[]): EndWindow | undefined {
  if (cands.length === 0) return undefined;
  const candidates = toTwoOrMore(
    cands as [BoundCandidate, ...BoundCandidate[]],
  );
  invariant(
    isTwoOrMore(candidates),
    "EndWindow requires >= 1 candidate (TwoOrMore enforced)",
  );
  return { combine: "EarlierOf" as const, candidates };
}

/** If a start window has all Date anchors, collapse to the single latest date. */
function maybeCollapseStartIfAllDates(
  w?: StartWindow,
): StartWindow | undefined {
  if (!w) return undefined;
  if (!w.candidates.every((c) => isDate(c.at))) return w;

  const latest = w.candidates.reduce((acc, cur) => {
    if ((cur.at as DateAnchor).value > (acc.at as DateAnchor).value) return cur;
    if ((cur.at as DateAnchor).value < (acc.at as DateAnchor).value) return acc;
    // equal date → conservative inclusivity (both must be inclusive to remain inclusive)
    return { ...acc, inclusive: acc.inclusive && cur.inclusive };
  });

  // return as a singleton encoded as TwoOrMore by duplication
  return { combine: "LaterOf" as const, candidates: [latest, latest] };
}

/** If an end window has all Date anchors, collapse to the single earliest date. */
function maybeCollapseEndIfAllDates(w?: EndWindow): EndWindow | undefined {
  if (!w) return undefined;
  if (!w.candidates.every((c) => isDate(c.at))) return w;

  const earliest = w.candidates.reduce((acc, cur) => {
    if ((cur.at as DateAnchor).value < (acc.at as DateAnchor).value) return cur;
    if ((cur.at as DateAnchor).value > (acc.at as DateAnchor).value) return acc;
    return { ...acc, inclusive: acc.inclusive && cur.inclusive };
  });

  return { combine: "EarlierOf" as const, candidates: [earliest, earliest] };
}

/* ------------------------
 * Bound combinators
 * ------------------------ */

/** Append a start candidate (LaterOf). */
export function pushStartCandidate(
  w: StartWindow | undefined,
  c: BoundCandidate<Anchor>,
): StartWindow {
  if (!w) return { combine: "LaterOf" as const, candidates: [c, c] }; // satisfy TwoOrMore via dup
  const next = {
    combine: "LaterOf" as const,
    candidates: [...w.candidates, c] as any,
  };
  invariant(
    isTwoOrMore(next.candidates),
    "StartWindow must keep TwoOrMore candidates",
  );
  return next;
}

/** Append an end candidate (EarlierOf). */
export function pushEndCandidate(
  w: EndWindow | undefined,
  c: BoundCandidate<Anchor>,
): EndWindow {
  if (!w) return { combine: "EarlierOf" as const, candidates: [c, c] };
  const next = {
    combine: "EarlierOf" as const,
    candidates: [...w.candidates, c] as any,
  };
  invariant(
    isTwoOrMore(next.candidates),
    "EndWindow must keep TwoOrMore candidates",
  );
  return next;
}

/** Merge two LaterOf start windows (concatenate candidates; no loss). */
export function mergeStartWindows(
  a?: StartWindow,
  b?: StartWindow,
): StartWindow | undefined {
  if (!a) return b;
  if (!b) return a;
  const merged = {
    combine: "LaterOf" as const,
    candidates: [...a.candidates, ...b.candidates] as any,
  };
  invariant(
    isTwoOrMore(merged.candidates),
    "StartWindow merge must keep TwoOrMore candidates",
  );
  return merged;
}

/** Merge two EarlierOf end windows (concatenate candidates; no loss). */
export function mergeEndWindows(
  a?: EndWindow,
  b?: EndWindow,
): EndWindow | undefined {
  if (!a) return b;
  if (!b) return a;
  const merged = {
    combine: "EarlierOf" as const,
    candidates: [...a.candidates, ...b.candidates] as any,
  };
  invariant(
    isTwoOrMore(merged.candidates),
    "EndWindow merge must keep TwoOrMore candidates",
  );
  return merged;
}

/**
 * Collapse a LaterOf start window if (and only if) all candidates are Dates.
 * Returns the original window if any candidate is an Event.
 */
export function collapseStartIfAllDates(
  w?: StartWindow,
): StartWindow | undefined {
  if (!w) return undefined;
  if (!w.candidates.every((c) => isDate(c.at))) return w;

  const latest = w.candidates.reduce((acc, cur) => {
    if ((cur.at as DateAnchor).value > (acc.at as DateAnchor).value) return cur;
    if ((cur.at as DateAnchor).value < (acc.at as DateAnchor).value) return acc;
    return { ...acc, inclusive: acc.inclusive && cur.inclusive };
  });

  return { combine: "LaterOf", candidates: [latest, latest] };
}

/**
 * Collapse an EarlierOf end window if (and only if) all candidates are Dates.
 * Returns the original window if any candidate is an Event.
 */
export function collapseEndIfAllDates(w?: EndWindow): EndWindow | undefined {
  if (!w) return undefined;
  if (!w.candidates.every((c) => isDate(c.at))) return w;

  const earliest = w.candidates.reduce((acc, cur) => {
    if ((cur.at as DateAnchor).value < (acc.at as DateAnchor).value) return cur;
    if ((cur.at as DateAnchor).value > (acc.at as DateAnchor).value) return acc;
    return { ...acc, inclusive: acc.inclusive && cur.inclusive };
  });

  return { combine: "EarlierOf", candidates: [earliest, earliest] };
}

/* ------------------------
 * Periodicity
 * ------------------------ */

function normalizePeriodicity(
  over: Duration | undefined,
  every: Duration | undefined,
  path: string[],
): Periodicity {
  invariant(
    over && every,
    "Both OVER and EVERY are required",
    { over, every },
    path,
  );
  invariant(
    over.unit === every.unit,
    "OVER and EVERY units must match",
    { over, every },
    path,
  );

  const span = over.value as Integer;
  const step = every.value as Integer;

  invariant(
    (span === 0 && step === 0) || span % step === 0,
    "OVER must be a multiple of EVERY",
    { over, every },
    path,
  );
  const count =
    span === 0 && step === 0 ? (1 as Integer) : ((span / step) as Integer);

  if (over.unit === "DAYS") {
    const p: PeriodicityInDays = {
      id: "",
      periodType: "DAYS",
      span,
      step,
      count,
    };
    return p;
  }

  // MONTHS: need vesting_day_of_month
  const p: PeriodicityInMonths = {
    id: "",
    periodType: "MONTHS",
    span,
    step,
    count,
    vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH", // TODO: figure out how to supply this downstream
  };
  return p;
}

function unitOfPeriodicity(p: Periodicity) {
  return p.periodType === "DAYS" ? "DAYS" : "MONTHS";
}
