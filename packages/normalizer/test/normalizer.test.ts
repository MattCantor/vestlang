import { describe, it, expect } from "vitest";
import {
  normalizeStatement,
  lowerPredicatesToWindow,
  pushStartCandidate,
  pushEndCandidate,
  mergeStartWindows,
  mergeEndWindows,
  collapseStartIfAllDates,
  collapseEndIfAllDates,
} from "../src/normalizer"; // adjust path

import type {
  ASTStatement,
  ASTExpr,
  ASTSchedule,
  DateAnchor,
  EventAnchor,
  TemporalPredNode,
  FromTerm,
} from "@vestlang/dsl";

import type {
  Schedule,
  StartWindow,
  EndWindow,
  VestingStartQualified,
} from "../src/types/normalized";

import { NormalizerError } from "../src/errors";

// Helpers
const date = (s: string): DateAnchor => ({ type: "Date", value: s });
const evt = (s: string): EventAnchor => ({ type: "Event", value: s });

function schedule(
  over: number,
  every: number,
  unit: "DAYS" | "MONTHS",
  from?: FromTerm,
  cliff?: any,
): ASTSchedule {
  return {
    type: "Schedule",
    from,
    over: { type: "Duration", value: over, unit },
    every: { type: "Duration", value: every, unit },
    cliff,
  };
}

function stmt(
  s: ASTSchedule,
  amount: any = { type: "AmountAbsolute", value: 100 },
): ASTStatement {
  return { amount, expr: s as unknown as ASTExpr };
}

describe("normalizeStatement / normalizeExpr", () => {
  it("normalizes a simple schedule with default FROM=Event('grantDate')", () => {
    const ast = schedule(12, 1, "MONTHS", undefined, undefined);
    const st = normalizeStatement(stmt(ast));
    expect(st.expr.type).toBe("Schedule");
    const sch = st.expr as Schedule;

    // vesting_start should be an unqualified Event('grantDate')
    if ("items" in sch.vesting_start) {
      throw new Error("vesting_start should not be a combinator here");
    } else {
      expect(sch.vesting_start.type).toBe("Unqualified");
      expect(sch.vesting_start.anchor).toEqual(evt("grantDate"));
    }

    // periodicity
    expect(sch.periodicity.periodType).toBe("MONTHS");
    expect((sch.periodicity as any).span).toBe(12);
    expect((sch.periodicity as any).step).toBe(1);
    expect((sch.periodicity as any).count).toBe(12);
    // placeholder for vesting_day_of_month
    expect((sch.periodicity as any).vesting_day_of_month).toBe(
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
  });

  it("normalizes FROM combinators (LaterOf)", () => {
    const from: FromTerm = {
      type: "LaterOf",
      items: [date("2025-01-01"), evt("ipo")],
    } as any;

    const ast = schedule(30, 10, "DAYS", from);
    const st = normalizeStatement(stmt(ast));
    const sch = st.expr as Schedule;
    expect(sch.vesting_start).toMatchObject({
      type: "LaterOf",
      items: [
        { type: "Unqualified", anchor: date("2025-01-01") },
        { type: "Unqualified", anchor: evt("ipo") },
      ],
    });
  });

  it("normalizes FROM QualifiedAnchor into a Window with candidates", () => {
    const qa = {
      type: "Qualified",
      base: evt("boardApproval"),
      predicates: [
        { type: "After", i: evt("hire"), strict: true },
        {
          type: "Between",
          a: date("2025-02-01"),
          b: evt("cic"),
          strict: false,
        },
      ],
    } as any;

    const ast = schedule(12, 3, "MONTHS", qa);
    const st = normalizeStatement(stmt(ast));
    const sch = st.expr as Schedule;

    if ("items" in sch.vesting_start) {
      throw new Error("Expected leaf Qualified vesting_start");
    }
    const vsq = sch.vesting_start as VestingStartQualified;
    expect(vsq.type).toBe("Qualified");
    expect(vsq.anchor).toEqual(evt("boardApproval"));

    // Window should capture all candidates, not collapse mixed event/date
    expect(vsq.window?.start?.combine).toBe("LaterOf");
    expect(vsq.window?.start?.candidates.length).toBeGreaterThanOrEqual(2);

    expect(vsq.window?.end?.combine).toBe("EarlierOf");
    expect(vsq.window?.end?.candidates.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Windows from predicates", () => {
  it("keeps all candidates when mixed events/dates; collapses when all dates", () => {
    const predsMixed: TemporalPredNode[] = [
      { type: "After", i: evt("hire"), strict: false },
      { type: "After", i: date("2025-01-15"), strict: false },
      { type: "Before", i: evt("cic"), strict: true },
    ];
    const wMixed = lowerPredicatesToWindow(predsMixed);
    // mixed → should not collapse to singletons
    expect(wMixed.start?.candidates.length!).toBeGreaterThanOrEqual(2);
    expect(wMixed.end?.candidates.length!).toBeGreaterThanOrEqual(2);

    const predsDates: TemporalPredNode[] = [
      { type: "After", i: date("2024-12-01"), strict: true },
      { type: "After", i: date("2025-01-01"), strict: false },
      { type: "Before", i: date("2025-06-01"), strict: false },
    ];
    const wDates = lowerPredicatesToWindow(predsDates);
    // all dates → should collapse to duplicated singletons
    expect(wDates.start?.candidates).toHaveLength(2);
    expect(wDates.end?.candidates).toHaveLength(2);
    const s0 = wDates.start!.candidates[0].at as DateAnchor;
    const e0 = wDates.end!.candidates[0].at as DateAnchor;
    expect(s0.value).toBe("2025-01-01"); // later of 12/01 and 01/01
    expect(e0.value).toBe("2025-06-01");
  });

  it("throws EMPTY_WINDOW_AFTER_RESOLVE on equal date with exclusivity", () => {
    const preds: TemporalPredNode[] = [
      { type: "After", i: date("2025-02-01"), strict: true }, // exclusive
      { type: "Before", i: date("2025-02-01"), strict: false }, // inclusive
    ];
    expect(() => lowerPredicatesToWindow(preds)).toThrowError(NormalizerError);
  });
});

describe("Cliff folding", () => {
  it("duration cliff populates periodicity.cliff with unit check", () => {
    const ast = schedule(12, 1, "MONTHS", undefined, {
      type: "Duration",
      value: 6,
      unit: "MONTHS",
    });
    const st = normalizeStatement(stmt(ast));
    const sch = st.expr as Schedule;
    expect((sch.periodicity as any).cliff).toBe(6);
  });

  it("mismatched duration cliff unit throws", () => {
    const ast = schedule(12, 1, "MONTHS", undefined, {
      type: "Duration",
      value: 180,
      unit: "DAYS",
    });
    expect(() => normalizeStatement(stmt(ast))).toThrowError(NormalizerError);
  });

  it("anchor cliff becomes LaterOf([FROM, CLIFF]) without flattening", () => {
    // FROM = 2025-01-01
    // CLIFF = evt('firstTrade')
    const ast = schedule(30, 10, "DAYS", date("2025-01-01"), evt("firstTrade"));
    const st = normalizeStatement(stmt(ast));
    const sch = st.expr as Schedule;

    // Expect pair (no flatten)
    expect("items" in sch.vesting_start).toBe(true);
    if ("items" in sch.vesting_start) {
      expect(sch.vesting_start.type).toBe("LaterOf");
      expect(sch.vesting_start.items).toHaveLength(2);
      // left is FROM, right is CLIFF (by construction)
      expect(sch.vesting_start.items[0]).toMatchObject({
        type: "Unqualified",
        anchor: date("2025-01-01"),
      });
      expect(sch.vesting_start.items[1]).toMatchObject({
        type: "Unqualified",
        anchor: evt("firstTrade"),
      });
    }
  });

  it("cliff with combinator preserves structure", () => {
    const cliff: FromTerm = {
      type: "EarlierOf",
      items: [evt("boardApproval"), date("2025-03-01")],
    } as any;

    const ast = schedule(12, 3, "MONTHS", evt("grantDate"), cliff);
    const st = normalizeStatement(stmt(ast));
    const sch = st.expr as Schedule;

    expect("items" in sch.vesting_start).toBe(true);
    if ("items" in sch.vesting_start) {
      expect(sch.vesting_start.type).toBe("LaterOf");
      const [, right] = sch.vesting_start.items;
      expect("items" in right).toBe(true);
      if ("items" in right) {
        expect(right.type).toBe("EarlierOf");
        expect(right.items.length).toBe(2);
      }
    }
  });
});

describe("Periodicity", () => {
  it("validates OVER and EVERY and computes span/step/count", () => {
    const ast = schedule(18, 6, "MONTHS", evt("grantDate"));
    const sch = normalizeStatement(stmt(ast)).expr as Schedule;
    expect(sch.periodicity.periodType).toBe("MONTHS");
    expect((sch.periodicity as any).span).toBe(18);
    expect((sch.periodicity as any).step).toBe(6);
    expect((sch.periodicity as any).count).toBe(3);
  });

  it("throws when OVER % EVERY !== 0", () => {
    const ast = schedule(10, 3, "DAYS", evt("grantDate"));
    expect(() => normalizeStatement(stmt(ast))).toThrowError(NormalizerError);
  });

  it("keeps vesting_day_of_month placeholder for MONTHS", () => {
    const ast = schedule(12, 1, "MONTHS", evt("grantDate"));
    const sch = normalizeStatement(stmt(ast)).expr as Schedule;
    expect((sch.periodicity as any).vesting_day_of_month).toBe(
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
  });
});

describe("Bound combinators helpers", () => {
  it("pushStartCandidate duplicates singleton to satisfy TwoOrMore; pushEndCandidate likewise", () => {
    const s1 = pushStartCandidate(undefined, {
      at: evt("hire"),
      inclusive: true,
    });
    expect(s1.candidates).toHaveLength(2);

    const e1 = pushEndCandidate(undefined, {
      at: date("2025-06-01"),
      inclusive: true,
    });
    expect(e1.candidates).toHaveLength(2);

    const s2 = pushStartCandidate(s1, {
      at: date("2025-01-01"),
      inclusive: false,
    });
    expect(s2.candidates.length).toBe(3);

    const e2 = pushEndCandidate(e1, { at: evt("cic"), inclusive: false });
    expect(e2.candidates.length).toBe(3);
  });

  it("mergeStartWindows / mergeEndWindows concatenates candidates", () => {
    const a: StartWindow = {
      combine: "LaterOf",
      candidates: [
        { at: evt("hire"), inclusive: true },
        { at: date("2024-12-01"), inclusive: true },
      ],
    };
    const b: StartWindow = {
      combine: "LaterOf",
      candidates: [
        { at: date("2025-01-01"), inclusive: true },
        { at: evt("boardApproval"), inclusive: false },
      ],
    };
    const merged = mergeStartWindows(a, b)!;
    expect(merged.candidates.length).toBe(4);

    const ae: EndWindow = {
      combine: "EarlierOf",
      candidates: [
        { at: evt("cic"), inclusive: true },
        { at: date("2025-06-01"), inclusive: true },
      ],
    };
    const be: EndWindow = {
      combine: "EarlierOf",
      candidates: [
        { at: date("2025-07-01"), inclusive: true },
        { at: evt("ipo"), inclusive: false },
      ],
    };
    const mergedE = mergeEndWindows(ae, be)!;
    expect(mergedE.candidates.length).toBe(4);
  });

  it("collapseStartIfAllDates / collapseEndIfAllDates collapse only when all candidates are dates", () => {
    const swMixed: StartWindow = {
      combine: "LaterOf",
      candidates: [
        { at: evt("hire"), inclusive: true },
        { at: date("2025-01-01"), inclusive: true },
      ],
    };
    expect(collapseStartIfAllDates(swMixed)).toBe(swMixed);

    const swDates: StartWindow = {
      combine: "LaterOf",
      candidates: [
        { at: date("2024-12-01"), inclusive: true },
        { at: date("2025-01-01"), inclusive: true },
      ],
    };
    const collapsedS = collapseStartIfAllDates(swDates)!;
    expect(collapsedS.candidates).toHaveLength(2);
    expect((collapsedS.candidates[0].at as DateAnchor).value).toBe(
      "2025-01-01",
    );

    const ewDates: EndWindow = {
      combine: "EarlierOf",
      candidates: [
        { at: date("2025-06-01"), inclusive: true },
        { at: date("2025-07-01"), inclusive: true },
      ],
    };
    const collapsedE = collapseEndIfAllDates(ewDates)!;
    expect((collapsedE.candidates[0].at as DateAnchor).value).toBe(
      "2025-06-01",
    );
  });
});
