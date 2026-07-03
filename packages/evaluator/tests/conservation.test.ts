// R2-T1 — the conservation invariant, swept cross-arm.
//
// For T = the program's exact fraction sum (QUANTITY v lowering to v/grant):
// when T ≤ 1 every surface totals exactly floor(grant × T) regardless of
// which statements are dated, pending, or void (the #221 claim cursor closes
// the telescope); when T > 1 the dated path delivers uncapped under the error
// finding while the symbolic side claims exactly the gap to the grant.
//
// The as-of partition keeps four disjoint buckets — vested, unvested,
// impossible, and the not-yet-schedulable `unresolved` tally — so the
// conservation equation sums all four.

import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { floorSharesAt } from "@vestlang/primitives";
import type { Fraction, OCTDate } from "@vestlang/types";
import type { EvaluatedSchedule, Installment } from "@vestlang/types";
import {
  CONTINGENT_START_SENTINEL,
  fracSum,
  bigCmp,
  BIG_ONE,
  toBigRational,
  ZERO,
} from "@vestlang/utils";
import { evaluateProgram } from "../src/evaluate";
import { evaluateProgramAsOf } from "../src/asof";
import type { VestedResult } from "../src/asof";

const GRANT_DATE = "2024-01-01";
const AS_OFS = ["2023-06-01", "2024-09-15", "2031-01-01"] as const;
const GRANTS = [0, 1, 7, 100, 4800] as const;
const EARLY = "2024-03-10"; // satisfies BEFORE 2025-01-01, violates AFTER 2025-01-01
const LATE = "2025-06-01"; // the mirror image

type AuthoredAmount =
  | { kind: "PORTION"; numerator: number; denominator: number }
  | { kind: "QUANTITY"; value: number };

interface Shape {
  name: string;
  dsl: string;
  /** Authored amounts in statement order — the oracle's only input besides the grant. */
  amounts: AuthoredAmount[];
  /** Every event id the DSL references; drives the firing-pattern dimension. */
  events: string[];
}

const P = (numerator: number, denominator: number): AuthoredAmount => ({
  kind: "PORTION",
  numerator,
  denominator,
});
const Q = (value: number): AuthoredAmount => ({ kind: "QUANTITY", value });

const SHAPES: Shape[] = [
  {
    name: "dated single grid",
    dsl: "VEST OVER 12 months EVERY 1 month",
    amounts: [P(1, 1)],
    events: [],
  },
  {
    name: "dated grid, duration cliff",
    dsl: "VEST OVER 48 months EVERY 1 month CLIFF vestingStart + 12 months",
    amounts: [P(1, 1)],
    events: [],
  },
  {
    name: "dated grid, cross-unit cliff",
    dsl: "VEST OVER 12 months EVERY 1 month CLIFF vestingStart + 45 days",
    amounts: [P(1, 1)],
    events: [],
  },
  {
    name: "bare event start",
    dsl: "VEST FROM EVENT a OVER 12 months EVERY 1 month",
    amounts: [P(1, 1)],
    events: ["a"],
  },
  {
    name: "windowed start, BEFORE deadline",
    dsl: "VEST FROM EVENT a BEFORE DATE 2025-01-01 OVER 12 months EVERY 1 month",
    amounts: [P(1, 1)],
    events: ["a"],
  },
  {
    name: "windowed start, AFTER deadline",
    dsl: "VEST FROM EVENT a AFTER DATE 2025-01-01 OVER 12 months EVERY 1 month",
    amounts: [P(1, 1)],
    events: ["a"],
  },
  {
    name: "LATER OF date/event start",
    dsl: "VEST FROM LATER OF ( grantDate + 12 months, EVENT ipo ) OVER 12 months EVERY 1 month",
    amounts: [P(1, 1)],
    events: ["ipo"],
  },
  {
    name: "EARLIER OF date/event start",
    dsl: "VEST FROM EARLIER OF ( DATE 2024-06-01, EVENT ipo ) OVER 12 months EVERY 1 month",
    amounts: [P(1, 1)],
    events: ["ipo"],
  },
  {
    name: "bare event cliff",
    dsl: "VEST OVER 12 months EVERY 1 month CLIFF EVENT board",
    amounts: [P(1, 1)],
    events: ["board"],
  },
  {
    name: "gated event cliff",
    dsl: "VEST OVER 12 months EVERY 1 month CLIFF EVENT board AFTER DATE 2026-01-01",
    amounts: [P(1, 1)],
    events: ["board"],
  },
  {
    // A cross-unit deferred cliff (months over a days grid) on a pending event
    // start can't be placed until ipo fires AND keeps no event_condition (it's a
    // non-event, cross-unit cliff), so the unfired run is genuinely
    // unresolved/symbolic-only — the arm event cliffs no longer reach since #255.
    name: "pending event start, cross-unit deferred cliff",
    dsl: "VEST FROM EVENT ipo OVER 30 days EVERY 30 days CLIFF vestingStart + 12 months",
    amounts: [P(1, 1)],
    events: ["ipo"],
  },
  {
    name: "THEN chain, dated head",
    dsl: "1/4 VEST OVER 12 months EVERY 1 month THEN 3/4 VEST OVER 36 months EVERY 1 month",
    amounts: [P(1, 4), P(3, 4)],
    events: [],
  },
  {
    // Terminating shares (1/4, 3/4). A THEN chain lowers to one canonical
    // template, so each statement's percentage is stored as a Numeric decimal; a
    // repeating share like 1/3 would truncate and lose a share off the
    // telescoped total (that precision loss is exercised by the precision-guard
    // tests). Terminating shares store exactly, so the chain still conserves.
    name: "THEN chain, event head",
    dsl: "1/4 VEST FROM EVENT ipo OVER 1 month EVERY 1 month THEN 3/4 VEST OVER 1 month EVERY 1 month",
    amounts: [P(1, 4), P(3, 4)],
    events: ["ipo"],
  },
  {
    name: "THEN chain, two tails",
    dsl: "1/4 VEST FROM EVENT ipo OVER 1 month EVERY 1 month THEN 1/4 VEST OVER 1 month EVERY 1 month THEN 1/2 VEST OVER 2 months EVERY 1 month",
    amounts: [P(1, 4), P(1, 4), P(1, 2)],
    events: ["ipo"],
  },
  {
    // Terminating shares (1/4, 3/4): see "THEN chain, event head" above — a
    // template stores Numeric decimals, so the chain conserves only when the
    // shares terminate.
    name: "THEN chain, cliffed tail",
    dsl: "1/4 VEST FROM EVENT ipo OVER 1 month EVERY 1 month THEN 3/4 VEST OVER 12 months EVERY 1 month CLIFF vestingStart + 3 months",
    amounts: [P(1, 4), P(3, 4)],
    events: ["ipo"],
  },
  {
    // #412 — a held-cliff HEAD with a THEN tail. Dated head, but its grid is held
    // on an unfired event cliff. Unfired the whole chain pends; fired the head folds
    // and the tail re-anchors after it. The shares (1/2, 1/2) must conserve in every
    // firing pattern — the tail can no longer date off the un-held grid end and
    // double-count, nor vanish behind the hold.
    name: "THEN tail behind a held-cliff head",
    dsl: "1/2 VEST OVER 4 months EVERY 1 month CLIFF EVENT ipo THEN 1/2 VEST OVER 4 months EVERY 1 month",
    amounts: [P(1, 2), P(1, 2)],
    events: ["ipo"],
  },
  {
    // #412 Decision A — the held cliff on an intermediate TAIL, behind a dated head.
    // The dated head vests; the held tail folds (or pends); the last tail must not
    // date off the held tail's un-held grid end. Shares (1/4, 1/4, 1/2) conserve
    // across firing patterns.
    name: "THEN tail behind a held-cliff tail",
    dsl: "1/4 VEST OVER 4 months EVERY 1 month THEN 1/4 VEST OVER 4 months EVERY 1 month CLIFF EVENT ipo THEN 1/2 VEST OVER 4 months EVERY 1 month",
    amounts: [P(1, 4), P(1, 4), P(1, 2)],
    events: ["ipo"],
  },
  {
    // #412 — a SYNTHETIC (multi-event) held cliff on the head. `LATER OF(a, b)`
    // lowers to a synthetic event side, so the firing-pattern sweep exercises the
    // partial-fire case (only `a`) as well as fully-fired (max(a,b) folds the head)
    // and unfired (the whole chain pends). The tail's re-anchor reads the same fold
    // point in every pattern, so the (1/2, 1/2) shares conserve throughout.
    name: "THEN tail behind a synthetic held-cliff head",
    dsl: "1/2 VEST OVER 4 months EVERY 1 month CLIFF LATER OF ( EVENT a , EVENT b ) THEN 1/2 VEST OVER 4 months EVERY 1 month",
    amounts: [P(1, 2), P(1, 2)],
    events: ["a", "b"],
  },
  {
    name: "two independent grids (events arm)",
    dsl: "1/2 VEST FROM DATE 2024-01-01 OVER 2 months EVERY 1 month PLUS 1/2 VEST FROM DATE 2024-06-15 OVER 2 months EVERY 1 month",
    amounts: [P(1, 2), P(1, 2)],
    events: [],
  },
  {
    name: "events arm with pending sibling",
    dsl: "1/2 VEST FROM DATE 2024-01-01 OVER 2 months EVERY 1 month PLUS 1/4 VEST FROM DATE 2024-06-15 OVER 2 months EVERY 1 month PLUS 1/4 VEST FROM EVENT ipo OVER 2 months EVERY 1 month",
    amounts: [P(1, 2), P(1, 4), P(1, 4)],
    events: ["ipo"],
  },
  {
    name: "dated sibling + event-cliffed sibling",
    dsl: "1/2 VEST OVER 2 months EVERY 1 month PLUS 1/2 VEST OVER 2 months EVERY 1 month CLIFF EVENT board",
    amounts: [P(1, 2), P(1, 2)],
    events: ["board"],
  },
  {
    name: "three thirds on events",
    dsl: "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month PLUS 1/3 VEST FROM EVENT b OVER 1 month EVERY 1 month PLUS 1/3 VEST FROM EVENT c OVER 1 month EVERY 1 month",
    amounts: [P(1, 3), P(1, 3), P(1, 3)],
    events: ["a", "b", "c"],
  },
  {
    name: "sevenths on events",
    dsl: "1/7 VEST FROM EVENT a OVER 1 month EVERY 1 month PLUS 2/7 VEST FROM EVENT b OVER 1 month EVERY 1 month PLUS 4/7 VEST FROM EVENT c OVER 1 month EVERY 1 month",
    amounts: [P(1, 7), P(2, 7), P(4, 7)],
    events: ["a", "b", "c"],
  },
  {
    name: "pending third before dated rest",
    dsl: "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month PLUS 2/3 VEST OVER 2 months EVERY 1 month",
    amounts: [P(1, 3), P(2, 3)],
    events: ["a"],
  },
  {
    name: "under-allocated pair",
    dsl: "1/3 VEST OVER 1 month EVERY 1 month PLUS 1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month",
    amounts: [P(1, 3), P(1, 3)],
    events: ["a"],
  },
  {
    name: "over-allocated, both pending",
    dsl: "3/4 VEST FROM EVENT a OVER 1 month EVERY 1 month PLUS 3/4 VEST FROM EVENT b OVER 1 month EVERY 1 month",
    amounts: [P(3, 4), P(3, 4)],
    events: ["a", "b"],
  },
  {
    name: "over-allocated, both dated",
    dsl: "3/4 VEST OVER 1 month EVERY 1 month PLUS 3/4 VEST FROM DATE 2024-06-15 OVER 1 month EVERY 1 month",
    amounts: [P(3, 4), P(3, 4)],
    events: [],
  },
  {
    name: "windowed 2/3 + pending 2/3",
    dsl: "2/3 VEST FROM EVENT a BEFORE DATE 2025-01-01 OVER 1 month EVERY 1 month PLUS 2/3 VEST FROM EVENT b OVER 1 month EVERY 1 month",
    amounts: [P(2, 3), P(2, 3)],
    events: ["a", "b"],
  },
  {
    name: "quantity pair",
    dsl: "40 VEST OVER 1 month EVERY 1 month PLUS 60 VEST FROM EVENT a OVER 1 month EVERY 1 month",
    amounts: [Q(40), Q(60)],
    events: ["a"],
  },
  {
    name: "single over-grant quantity",
    dsl: "150 VEST FROM EVENT a OVER 1 month EVERY 1 month",
    amounts: [Q(150)],
    events: ["a"],
  },
  {
    name: "two full-grant quantities",
    dsl: "100 VEST FROM EVENT a OVER 1 month EVERY 1 month PLUS 100 VEST FROM EVENT b OVER 1 month EVERY 1 month",
    amounts: [Q(100), Q(100)],
    events: ["a", "b"],
  },
];

// The oracle's lowering: QUANTITY v on grant g is v/g; zero-share grant claims
// nothing. Deliberately not imported from claims.ts — a bug in the evaluator's
// own lowering must not bend the expected value to match it.
const loweredFraction = (a: AuthoredAmount, grant: number): Fraction =>
  a.kind === "QUANTITY"
    ? grant === 0
      ? ZERO
      : { numerator: a.value, denominator: grant }
    : { numerator: a.numerator, denominator: a.denominator };

const fractionTotal = (shape: Shape, grant: number): Fraction =>
  fracSum(shape.amounts.map((a) => loweredFraction(a, grant)));

const sumAmounts = (xs: readonly { amount: number }[]): number =>
  xs.reduce((n, x) => n + x.amount, 0);

// Firing patterns for a shape's event list. Two dates straddle the corpus's
// window deadline (2025-01-01), so the same windowed shape lands live, void,
// and pending across patterns.
const firingPatterns = (events: string[]): Record<string, OCTDate>[] => {
  const fire = (date: OCTDate) =>
    Object.fromEntries(events.map((e) => [e, date]));
  if (events.length === 0) return [{}];
  const patterns: Record<string, OCTDate>[] = [{}, fire(EARLY), fire(LATE)];
  if (events.length > 1) patterns.push({ [events[0]]: EARLY });
  return patterns;
};

// --- Coverage tracking ---
// Filled by every checkCell call; asserted once, after the sweep.
// vitest runs tests in declaration order, so the gate it lives in last.
const seen = new Set<string>();

function recordCoverage(s: EvaluatedSchedule): void {
  const inst = s.resolution.installments;
  const hasU = inst.some((i) => i.state === "UNRESOLVED");
  const hasR = inst.some((i) => i.state === "RESOLVED");
  const hasI = inst.some((i) => i.state === "IMPOSSIBLE");
  switch (s.resolution.status) {
    case "template":
      seen.add(hasU ? "template/pending" : "template/dated");
      break;
    case "events-only":
      seen.add(hasU ? "events-only/pending-sibling" : "events-only/dated");
      break;
    case "unresolved":
      if (hasI) seen.add("unresolved/with-impossible");
      if (hasR) seen.add("unresolved/with-dated");
      if (!hasI && !hasR) seen.add("unresolved/symbolic-only");
      break;
    case "impossible":
      seen.add("impossible");
      break;
  }
  if (inst.length === 0) seen.add("asof/fallback");
  if (s.interchange.status === "events-only")
    seen.add("interchange/events-only");
  if (s.findings.some((f) => f.kind === "over-allocation"))
    seen.add("class/over-allocated");
  if (s.findings.some((f) => f.kind === "under-allocation"))
    seen.add("class/under-allocated");
}

// --- Cell checker ---

const cellLabel = (
  shape: Shape,
  grant: number,
  events: Record<string, OCTDate>,
  extra = "",
) =>
  `\n  dsl:    ${shape.dsl}\n  grant:  ${grant}\n  events: ${JSON.stringify(events)}${extra}`;

const partitionLabel = (r: VestedResult) =>
  `\n  partition: vested=${sumAmounts(r.vested)} unvested=${sumAmounts(r.unvested)} impossible=${sumAmounts(r.impossible)} unresolved=${r.unresolved}`;

// One installment stream's conservation claim.
// T ≤ 1: the closed form — the stream totals floor(grant × T) no matter how
// its statements routed. T > 1: the dated part delivers uncapped under the
// error finding; the symbolic part claims exactly the gap to the grant (never
// negative, never past it).
function checkStream(
  installments: readonly Installment[],
  grant: number,
  T: Fraction,
  label: string,
): void {
  const resolved = sumAmounts(
    installments.filter((i) => i.state === "RESOLVED"),
  );
  const symbolic = sumAmounts(
    installments.filter((i) => i.state !== "RESOLVED"),
  );
  if (bigCmp(toBigRational(T), BIG_ONE) <= 0) {
    expect(resolved + symbolic, label).toBe(
      floorSharesAt(grant, toBigRational(T)),
    );
  } else {
    expect(symbolic, label).toBe(Math.max(grant - resolved, 0));
  }
}

// No RESOLVED projection date ever carries the contingent-start sentinel: that
// value lives only on `runtime.startDate` for a still-pending contingent start,
// never on the grid a projection materializes. A dateless IMPOSSIBLE tranche has
// no projection date to check, so it's out of scope here.
function assertNoSentinelDate(
  installments: readonly Installment[],
  label: string,
): void {
  for (const i of installments) {
    if (i.state === "RESOLVED") {
      expect(i.date, label).not.toBe(CONTINGENT_START_SENTINEL);
    }
  }
}

function checkCell(
  shape: Shape,
  grant: number,
  events: Record<string, OCTDate>,
): void {
  const program = normalizeProgram(parse(shape.dsl));
  const T = fractionTotal(shape, grant);
  const overAllocated = bigCmp(toBigRational(T), BIG_ONE) > 0;
  const base = { grantDate: GRANT_DATE, events, grantQuantity: grant };
  const label = cellLabel(shape, grant, events);

  const schedule = evaluateProgram(program, base);
  recordCoverage(schedule);

  // The schedule stream itself, in whichever arm it landed.
  checkStream(
    schedule.resolution.installments,
    grant,
    T,
    `${label}\n  surface: resolution.installments (status=${schedule.resolution.status})`,
  );

  // The firing-blind interchange stream, when it carries installments.
  if (schedule.interchange.status === "events-only") {
    checkStream(
      schedule.interchange.installments,
      grant,
      T,
      `${label}\n  surface: interchange.installments`,
    );
    // Same stream, the negative check: no interchange tranche dates on the sentinel.
    assertNoSentinelDate(
      schedule.interchange.installments,
      `${label}\n  surface: interchange.installments`,
    );
  }

  // The resolution stream always carries installments; none dates on the sentinel.
  assertNoSentinelDate(
    schedule.resolution.installments,
    `${label}\n  surface: resolution.installments`,
  );

  // Findings track the validity class exactly (a zero-share grant raises neither).
  if (grant > 0) {
    expect(
      schedule.findings.some((f) => f.kind === "over-allocation"),
      `${label}\n  surface: findings`,
    ).toBe(overAllocated);
    expect(
      schedule.findings.some((f) => f.kind === "under-allocation"),
      `${label}\n  surface: findings`,
    ).toBe(bigCmp(toBigRational(T), BIG_ONE) < 0);
  }

  // The as-of partition at three dates. The total is asOf-invariant (resolution
  // never reads asOf; only the vested/unvested split moves) and vested grows
  // monotonically. The four buckets are disjoint, so impossible amounts are
  // added into the total alongside vested, unvested, and unresolved.
  let priorVested = -1;
  for (const asOf of AS_OFS) {
    const r = evaluateProgramAsOf(program, { ...base, asOf });
    const asOfLabel = `${label}\n  asOf:   ${asOf}${partitionLabel(r)}`;

    // The sentinel never surfaces as a real vest date in either dated partition.
    // `r.impossible` is dateless and deliberately not checked.
    assertNoSentinelDate(r.vested, `${asOfLabel}\n  surface: vested`);
    assertNoSentinelDate(r.unvested, `${asOfLabel}\n  surface: unvested`);

    const total =
      sumAmounts(r.vested) +
      sumAmounts(r.unvested) +
      sumAmounts(r.impossible) +
      r.unresolved;

    if (bigCmp(toBigRational(T), BIG_ONE) <= 0) {
      expect(total, asOfLabel).toBe(floorSharesAt(grant, toBigRational(T)));
    } else {
      // Over-allocation: the symbolic-and-impossible side claims exactly the gap
      // the dated tranches left to the grant.
      expect(sumAmounts(r.impossible) + r.unresolved, asOfLabel).toBe(
        Math.max(grant - (sumAmounts(r.vested) + sumAmounts(r.unvested)), 0),
      );
    }
    // Cross-surface agreement: when the resolution stream is non-empty, the
    // as-of total equals the installment-stream sum.
    if (schedule.resolution.installments.length > 0) {
      expect(total, asOfLabel).toBe(
        sumAmounts(schedule.resolution.installments),
      );
    }
    // Impossible is its own bucket now, not a slice of unresolved — both stay
    // non-negative.
    expect(sumAmounts(r.impossible), asOfLabel).toBeGreaterThanOrEqual(0);
    expect(r.unresolved, asOfLabel).toBeGreaterThanOrEqual(0);
    expect(sumAmounts(r.vested), asOfLabel).toBeGreaterThanOrEqual(priorVested);
    priorVested = sumAmounts(r.vested);
  }
}

// --- Sweep: 27 shapes × 5 grants = 135 tests, 350 cells ---

describe("conservation invariant — corpus sweep (R2-T1)", () => {
  for (const shape of SHAPES) {
    describe(shape.name, () => {
      for (const grant of GRANTS) {
        it(`conserves at grant ${grant} across firings and as-of dates`, () => {
          for (const events of firingPatterns(shape.events)) {
            checkCell(shape, grant, events);
          }
        });
      }
    });
  }
});

// --- Hand-computed spot values ---
// Thirteen cases that pin exact lump splits, remainder placement, and edge
// grants the sweep alone wouldn't fully nail. All use grantDate 2024-01-01.

describe("conservation invariant — spot values (R2-T1)", () => {
  // 1. Three pending thirds split [33, 33, 34]: remainder rides the last lump.
  it("three pending thirds split [33, 33, 34] at grant 100", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT b OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT c OVER 1 month EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: GRANT_DATE,
      events: {},
      grantQuantity: 100,
      asOf: AS_OFS[2],
    };
    const schedule = evaluateProgram(program, ctx);
    // Three distinct event starts are more than one start origin, so the
    // verdict is events-only; the lumps still telescope to [33, 33, 34].
    expect(schedule.resolution.status).toBe("events-only");
    expect(schedule.resolution.installments.map((i) => i.amount)).toEqual([
      33, 33, 34,
    ]);
    expect(evaluateProgramAsOf(program, ctx).unresolved).toBe(100);
  });

  // 2. All three fired: the conservation across the firing transition.
  it("three thirds fired all deliver 100", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT b OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT c OVER 1 month EVERY 1 month",
      ),
    );
    const events = { a: EARLY, b: EARLY, c: EARLY };
    const ctx = {
      grantDate: GRANT_DATE,
      events,
      grantQuantity: 100,
      asOf: AS_OFS[2],
    };
    const r = evaluateProgramAsOf(program, ctx);
    expect(sumAmounts(r.vested)).toBe(100);
    expect(r.unresolved).toBe(0);
  });

  // 3. Sevenths split [14, 28, 58]: floor(100/7), floor(300/7)-14, 100-42.
  it("sevenths split [14, 28, 58] at grant 100", () => {
    const program = normalizeProgram(
      parse(
        "1/7 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
          "PLUS 2/7 VEST FROM EVENT b OVER 1 month EVERY 1 month " +
          "PLUS 4/7 VEST FROM EVENT c OVER 1 month EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: GRANT_DATE,
      events: {},
      grantQuantity: 100,
      asOf: AS_OFS[2],
    };
    const schedule = evaluateProgram(program, ctx);
    expect(schedule.resolution.installments.map((i) => i.amount)).toEqual([
      14, 28, 58,
    ]);
    expect(evaluateProgramAsOf(program, ctx).unresolved).toBe(100);
  });

  // 4. Grant 1, three thirds: the single share lands on the last draw.
  it("grant 1, three thirds → lumps [0, 0, 1]", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT b OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT c OVER 1 month EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: GRANT_DATE,
      events: {},
      grantQuantity: 1,
      asOf: AS_OFS[2],
    };
    const schedule = evaluateProgram(program, ctx);
    expect(schedule.resolution.installments.map((i) => i.amount)).toEqual([
      0, 0, 1,
    ]);
    expect(
      sumAmounts(evaluateProgramAsOf(program, ctx).vested) +
        evaluateProgramAsOf(program, ctx).unresolved,
    ).toBe(1);
  });

  // 5. Mixed dated+pending: the basis is the dated fraction sum, not a textual
  //    prefix. UNRESOLVED 34 at position 1 (pending third comes first in the DSL
  //    but dates go into the cursor before live pending).
  it("pending third before dated rest: installments [RESOLVED 33, RESOLVED 33, UNRESOLVED 34]", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
          "PLUS 2/3 VEST OVER 2 months EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: GRANT_DATE,
      events: {},
      grantQuantity: 100,
      asOf: AS_OFS[2],
    };
    const schedule = evaluateProgram(program, ctx);
    const inst = schedule.resolution.installments;
    const resolved = inst.filter((i) => i.state === "RESOLVED");
    const unresolved = inst.filter((i) => i.state === "UNRESOLVED");
    expect(sumAmounts(resolved)).toBe(66);
    expect(sumAmounts(unresolved)).toBe(34);
    const r = evaluateProgramAsOf(program, ctx);
    expect(sumAmounts(r.vested)).toBe(66);
    expect(r.unresolved).toBe(34);
  });

  // 6. THEN chain, pending head: two UNRESOLVED lumps, total 100.
  it("THEN chain, event head: two UNRESOLVED lumps summing to 100", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST FROM EVENT ipo OVER 1 month EVERY 1 month THEN 2/3 VEST OVER 1 month EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: GRANT_DATE,
      events: {},
      grantQuantity: 100,
      asOf: AS_OFS[2],
    };
    const schedule = evaluateProgram(program, ctx);
    const unresolved = schedule.resolution.installments.filter(
      (i) => i.state === "UNRESOLVED",
    );
    expect(unresolved.map((i) => i.amount)).toEqual([33, 67]);
    expect(evaluateProgramAsOf(program, ctx).unresolved).toBe(100);
  });

  // 7. Cliffed pending tail telescopes too: symbolic amounts sum 100.
  it("THEN chain, cliffed tail: symbolic amounts sum 100", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST FROM EVENT ipo OVER 1 month EVERY 1 month " +
          "THEN 2/3 VEST OVER 12 months EVERY 1 month CLIFF vestingStart + 3 months",
      ),
    );
    const ctx = {
      grantDate: GRANT_DATE,
      events: {},
      grantQuantity: 100,
      asOf: AS_OFS[2],
    };
    const schedule = evaluateProgram(program, ctx);
    const symbolic = schedule.resolution.installments.filter(
      (i) => i.state !== "RESOLVED",
    );
    expect(sumAmounts(symbolic)).toBe(100);
    expect(evaluateProgramAsOf(program, ctx).unresolved).toBe(100);
  });

  // 8. Void draws last: windowed 2/3 violated, live 2/3 pending.
  //    IMPOSSIBLE 34, UNRESOLVED 66 — dead clause gets the clamped remainder.
  it("void draws last: windowed 2/3 + pending 2/3, a violated", () => {
    const program = normalizeProgram(
      parse(
        "2/3 VEST FROM EVENT a BEFORE DATE 2025-01-01 OVER 1 month EVERY 1 month " +
          "PLUS 2/3 VEST FROM EVENT b OVER 1 month EVERY 1 month",
      ),
    );
    const events = { a: LATE }; // fires after the BEFORE deadline
    const ctx = {
      grantDate: GRANT_DATE,
      events,
      grantQuantity: 100,
      asOf: AS_OFS[2],
    };
    const schedule = evaluateProgram(program, ctx);
    const inst = schedule.resolution.installments;
    const impossible = inst.filter((i) => i.state === "IMPOSSIBLE");
    const unresolved = inst.filter((i) => i.state === "UNRESOLVED");
    expect(sumAmounts(impossible)).toBe(34);
    expect(sumAmounts(unresolved)).toBe(66);
    const r = evaluateProgramAsOf(program, ctx);
    expect(sumAmounts(r.impossible)).toBe(34);
    expect(r.unresolved).toBe(66); // only the live pending clause
    // The two buckets stay disjoint and together cover the grant.
    expect(sumAmounts(r.impossible) + r.unresolved).toBe(100);
  });

  // 9. All-void clamps: two windows both violated, resolution status impossible.
  it("all-void clamps: both windowed statements violated", () => {
    const program = normalizeProgram(
      parse(
        "2/3 VEST FROM EVENT a BEFORE DATE 2025-01-01 OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT b BEFORE DATE 2025-01-01 OVER 1 month EVERY 1 month",
      ),
    );
    const events = { a: LATE, b: LATE };
    const ctx = {
      grantDate: GRANT_DATE,
      events,
      grantQuantity: 100,
      asOf: AS_OFS[2],
    };
    const schedule = evaluateProgram(program, ctx);
    expect(schedule.resolution.status).toBe("impossible");
    expect(schedule.resolution.installments.map((i) => i.amount)).toEqual([
      66, 34,
    ]);
    const r = evaluateProgramAsOf(program, ctx);
    expect(sumAmounts(r.impossible)).toBe(100);
    expect(r.unresolved).toBe(0); // all impossible, nothing left to schedule
    expect(
      sumAmounts(r.vested) +
        sumAmounts(r.unvested) +
        sumAmounts(r.impossible) +
        r.unresolved,
    ).toBe(100);
  });

  // 10. Two full-grant quantities clamp to [100, 0]: over-allocation, symbolic
  //     side claims exactly the gap (grant − 100 = 0).
  it("two full-grant quantities clamp to [100, 0]", () => {
    const program = normalizeProgram(
      parse(
        "100 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
          "PLUS 100 VEST FROM EVENT b OVER 1 month EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: GRANT_DATE,
      events: {},
      grantQuantity: 100,
      asOf: AS_OFS[2],
    };
    const schedule = evaluateProgram(program, ctx);
    expect(schedule.resolution.installments.map((i) => i.amount)).toEqual([
      100, 0,
    ]);
    expect(evaluateProgramAsOf(program, ctx).unresolved).toBe(100);
    expect(schedule.findings.some((f) => f.kind === "over-allocation")).toBe(
      true,
    );
  });

  // 11. Dated over-allocation delivers uncapped: both tranches fully dated, so
  //     no symbolic side and no conservation gap.
  it("dated over-allocation delivers uncapped: vested 150, unresolved 0", () => {
    const program = normalizeProgram(
      parse(
        "3/4 VEST OVER 1 month EVERY 1 month " +
          "PLUS 3/4 VEST FROM DATE 2024-06-15 OVER 1 month EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: GRANT_DATE,
      events: {},
      grantQuantity: 100,
      asOf: AS_OFS[2],
    };
    const r = evaluateProgramAsOf(program, ctx);
    expect(sumAmounts(r.vested)).toBe(150);
    expect(r.unresolved).toBe(0);
    expect(
      evaluateProgram(program, ctx).findings.some(
        (f) => f.kind === "over-allocation",
      ),
    ).toBe(true);
  });

  // 12. MAX_SAFE_INTEGER: the cursor must not lose a share at scale.
  //     (Also exercises #222's enforced quotient bound from below.)
  it("MAX_SAFE_INTEGER grant conserves exactly", () => {
    const g = Number.MAX_SAFE_INTEGER;
    const program = normalizeProgram(
      parse(
        "1/3 VEST OVER 1 month EVERY 1 month " +
          "PLUS 2/3 VEST FROM EVENT a OVER 1 month EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: GRANT_DATE,
      events: {},
      grantQuantity: g,
      asOf: AS_OFS[2],
    };
    const r = evaluateProgramAsOf(program, ctx);
    expect(sumAmounts(r.vested)).toBe(3_002_399_751_580_330);
    expect(r.unresolved).toBe(6_004_799_503_160_661);
    expect(sumAmounts(r.vested) + sumAmounts(r.unvested) + r.unresolved).toBe(
      g,
    );
  });

  // 13. The 4800 case cross-checked against the pre-existing classifier assertion.
  it("events arm with pending sibling, grant 4800, asOf 2026-01-01: vested 3600, unresolved 1200", () => {
    const program = normalizeProgram(
      parse(
        "1/2 VEST FROM DATE 2024-01-01 OVER 2 months EVERY 1 month " +
          "PLUS 1/4 VEST FROM DATE 2024-06-15 OVER 2 months EVERY 1 month " +
          "PLUS 1/4 VEST FROM EVENT ipo OVER 2 months EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: GRANT_DATE,
      events: {},
      grantQuantity: 4800,
      asOf: "2026-01-01",
    };
    const r = evaluateProgramAsOf(program, ctx);
    expect(sumAmounts(r.vested)).toBe(3600);
    expect(r.unresolved).toBe(1200);
  });
});

// --- Coverage gate (declared last; vitest runs in declaration order) ---
// If a future refactor reroutes shapes so an arm or pending channel is no longer
// exercised, this fails loudly instead of letting the suite silently shrink.

describe("conservation invariant — arm coverage", () => {
  it("the sweep reached every verdict arm, both pending channels, and both validity classes", () => {
    const required = [
      "template/dated",
      "template/pending",
      "events-only/dated",
      "events-only/pending-sibling",
      "unresolved/symbolic-only",
      "unresolved/with-dated",
      "unresolved/with-impossible",
      "impossible",
      "asof/fallback",
      "interchange/events-only",
      "class/over-allocated",
      "class/under-allocated",
    ];
    const missing = required.filter((k) => !seen.has(k));
    expect(
      missing,
      `arms no longer exercised by the corpus: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
