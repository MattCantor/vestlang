// packages/normalizer/test/normalizer.test.ts
import { describe, it, expect } from "vitest";

import type { DateAnchor, TemporalPredNode, FromTerm } from "@vestlang/dsl";

import { NormalizerError } from "../src/errors";
import {
  createDate,
  createEvent,
  createSchedule,
  createStatement,
} from "./helpers";
import { Schedule } from "../src/normalizer/schedule";
import { normalizeStatement } from "../src/normalizer";
import { VestingStartQualified } from "../src/normalizer/vesting-start-date";
import { lowerPredicatesToWindow } from "../src/normalizer/window";

describe("normalizeStatement / normalizeExpr", () => {
  it("normalizes a simple schedule with default FROM=Event('grantDate')", () => {
    const ast = createSchedule(12, 1, "MONTHS", undefined, undefined);
    const st = normalizeStatement(createStatement(ast));
    expect(st.expr.type).toBe("Schedule");
    const sch = st.expr as Schedule;

    // vesting_start should be an unqualified Event('grantDate')
    if ("items" in sch.vesting_start) {
      throw new Error("vesting_start should not be a combinator here");
    } else {
      expect(sch.vesting_start.type).toBe("Unqualified");
      expect(sch.vesting_start.anchor).toEqual(createEvent("grantDate"));
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
      items: [createDate("2025-01-01"), createEvent("ipo")],
    };

    const ast = createSchedule(30, 10, "DAYS", from);
    const st = normalizeStatement(createStatement(ast));
    const sch = st.expr as Schedule;
    expect(sch.vesting_start).toMatchObject({
      type: "LaterOf",
      items: [
        { type: "Unqualified", anchor: createDate("2025-01-01") },
        { type: "Unqualified", anchor: createEvent("ipo") },
      ],
    });
  });

  it("normalizes FROM QualifiedAnchor into a Window with candidate lists when 2+ bounds exist", () => {
    const qa = {
      type: "Qualified",
      base: createEvent("boardApproval"),
      predicates: [
        { type: "After", i: createEvent("hire"), strict: true }, // start #1
        {
          type: "Between",
          a: createDate("2025-02-01"),
          b: createEvent("cic"),
          strict: false,
        }, // start #2, end #1
        { type: "Before", i: createDate("2025-03-15"), strict: true }, // end #2
      ],
    } as any;

    const ast = createSchedule(12, 3, "MONTHS", qa);
    const st = normalizeStatement(createStatement(ast));
    const sch = st.expr as Schedule;

    if ("items" in sch.vesting_start) {
      throw new Error("Expected leaf Qualified vesting_start");
    }
    const vsq = sch.vesting_start as VestingStartQualified;
    expect(vsq.type).toBe("Qualified");
    expect(vsq.anchor).toEqual(createEvent("boardApproval"));

    // Window should keep combinators for 2+ bounds
    expect(vsq.window?.start?.type).toBe("LaterOf");
    if (vsq.window?.start?.type === "LaterOf") {
      expect(vsq.window.start.candidates.length).toBeGreaterThanOrEqual(2);
    }

    expect(vsq.window?.end?.type).toBe("EarlierOf");
    if (vsq.window?.end?.type === "EarlierOf") {
      expect(vsq.window.end.candidates.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("Windows from predicates (shape)", () => {
  it("mixed events/dates: LaterOf for multi-start; End for single end", () => {
    const predsMixed: TemporalPredNode[] = [
      { type: "After", i: createEvent("hire"), strict: false }, // start #1
      { type: "After", i: createDate("2025-01-15"), strict: false }, // start #2
      { type: "Before", i: createEvent("cic"), strict: true }, // end #1 (single)
    ];
    const wMixed = lowerPredicatesToWindow(predsMixed);

    // start has 2 bounds → LaterOf
    expect(wMixed.start?.type).toBe("LaterOf");
    if (wMixed.start?.type === "LaterOf") {
      expect(wMixed.start.candidates).toHaveLength(2);
    }

    // end has 1 bound → End (singleton)
    expect(wMixed.end?.type).toBe("End");
    if (wMixed.end?.type === "End") {
      expect(wMixed.end.bound.at).toEqual(createEvent("cic"));
      expect(wMixed.end.bound.inclusive).toBe(false); // strict=true → inclusive=false
    }
  });

  it("multiple end bounds produce EarlierOf; singletons produce Start/End", () => {
    const preds: TemporalPredNode[] = [
      { type: "After", i: createDate("2024-12-01"), strict: true }, // start #1
      { type: "Before", i: createDate("2025-06-01"), strict: false }, // end #1
      { type: "Before", i: createEvent("ipo"), strict: true }, // end #2
    ];
    const w = lowerPredicatesToWindow(preds);

    // single start bound → Start
    expect(w.start?.type).toBe("Start");
    if (w.start?.type === "Start") {
      expect((w.start.bound.at as DateAnchor).value).toBe("2024-12-01");
      expect(w.start.bound.inclusive).toBe(false);
    }

    // two end bounds → EarlierOf
    expect(w.end?.type).toBe("EarlierOf");
    if (w.end?.type === "EarlierOf") {
      expect(w.end.candidates.length).toBe(2);
    }
  });

  it.todo(
    "detects impossible/empty windows (e.g., equal date with exclusivity) and throws EMPTY_WINDOW_AFTER_RESOLVE",
  );
});

describe("Cliff folding", () => {
  it("duration cliff populates periodicity.cliff with unit check", () => {
    const ast = createSchedule(12, 1, "MONTHS", undefined, {
      type: "Duration",
      value: 6,
      unit: "MONTHS",
    });
    const st = normalizeStatement(createStatement(ast));
    const sch = st.expr as Schedule;
    expect((sch.periodicity as any).cliff).toBe(6);
  });

  it("mismatched duration cliff unit throws", () => {
    const ast = createSchedule(12, 1, "MONTHS", undefined, {
      type: "Duration",
      value: 180,
      unit: "DAYS",
    });
    expect(() => normalizeStatement(createStatement(ast))).toThrowError(
      NormalizerError,
    );
  });

  it("anchor cliff becomes LaterOf([FROM, CLIFF]) without flattening", () => {
    const ast = createSchedule(
      30,
      10,
      "DAYS",
      createDate("2025-01-01"),
      createEvent("firstTrade"),
    );
    const st = normalizeStatement(createStatement(ast));
    const sch = st.expr as Schedule;

    expect("items" in sch.vesting_start).toBe(true);
    if ("items" in sch.vesting_start) {
      expect(sch.vesting_start.type).toBe("LaterOf");
      expect(sch.vesting_start.items).toHaveLength(2);
      expect(sch.vesting_start.items[0]).toMatchObject({
        type: "Unqualified",
        anchor: createDate("2025-01-01"),
      });
      expect(sch.vesting_start.items[1]).toMatchObject({
        type: "Unqualified",
        anchor: createEvent("firstTrade"),
      });
    }
  });

  it("cliff with combinator preserves structure", () => {
    const cliff: FromTerm = {
      type: "EarlierOf",
      items: [createEvent("boardApproval"), createDate("2025-03-01")],
    } as any;

    const ast = createSchedule(
      12,
      3,
      "MONTHS",
      createEvent("grantDate"),
      cliff,
    );
    const st = normalizeStatement(createStatement(ast));
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
    const ast = createSchedule(18, 6, "MONTHS", createEvent("grantDate"));
    const sch = normalizeStatement(createStatement(ast)).expr as Schedule;
    expect(sch.periodicity.periodType).toBe("MONTHS");
    expect((sch.periodicity as any).span).toBe(18);
    expect((sch.periodicity as any).step).toBe(6);
    expect((sch.periodicity as any).count).toBe(3);
  });

  it("throws when OVER % EVERY !== 0", () => {
    const ast = createSchedule(10, 3, "DAYS", createEvent("grantDate"));
    expect(() => normalizeStatement(createStatement(ast))).toThrowError(
      NormalizerError,
    );
  });

  it("keeps vesting_day_of_month placeholder for MONTHS", () => {
    const ast = createSchedule(12, 1, "MONTHS", createEvent("grantDate"));
    const sch = normalizeStatement(createStatement(ast)).expr as Schedule;
    expect((sch.periodicity as any).vesting_day_of_month).toBe(
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
  });
});
