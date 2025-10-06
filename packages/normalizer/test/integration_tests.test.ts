import { describe, it, expect } from "vitest";
import { normalizeStatement } from "../src/normalizer";
import { NormalizerError } from "../src/errors";
import { expectMonthsPeriodicity, parseOne } from "./helpers";

describe("Integration: normalize DSL statements end-to-end", () => {
  describe("Amounts + simple schedules", () => {
    it("123 VEST SCHEDULE OVER 12 months EVERY 1 month", () => {
      const st = normalizeStatement(
        parseOne("123 VEST SCHEDULE OVER 12 months EVERY 1 month"),
      );
      expect(st.amount).toEqual({ type: "AmountAbsolute", value: 123 });
      expectMonthsPeriodicity(st.expr, 12, 1, 12);
      // default FROM
      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect(st.expr.vesting_start).toMatchObject({
        type: "Unqualified",
        anchor: { type: "Event", value: "grantDate" },
      });
    });

    it("0.25 VEST SCHEDULE OVER 12 months EVERY 1 month", () => {
      const st = normalizeStatement(
        parseOne("0.25 VEST SCHEDULE OVER 12 months EVERY 1 month"),
      );
      expect(st.amount).toEqual({
        type: "AmountPercent",
        numerator: "25",
        denominator: "100",
      });
      expectMonthsPeriodicity(st.expr, 12, 1, 12);
    });

    it(".5 VEST SCHEDULE OVER 12 months EVERY 1 month", () => {
      const st = normalizeStatement(
        parseOne(".5 VEST SCHEDULE OVER 12 months EVERY 1 month"),
      );
      expect(st.amount).toEqual({
        type: "AmountPercent",
        numerator: "50",
        denominator: "100",
      });
      expectMonthsPeriodicity(st.expr, 12, 1, 12);
    });

    it("VEST SCHEDULE OVER 12 months EVERY 1 month (implicit 100)", () => {
      const st = normalizeStatement(
        parseOne("VEST SCHEDULE OVER 12 months EVERY 1 month"),
      );
      // parser typically emits { type: AmountAbsolute, value: 100 } or similar default.
      // We only assert the normalized shape is AmountAbsolute.
      expect(st.amount.type).toBe("AmountPercent");
      expectMonthsPeriodicity(st.expr, 12, 1, 12);
    });
  });

  describe("FROM variants (anchors & combinators)", () => {
    it("VEST SCHEDULE FROM DATE 2027-01-01", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST SCHEDULE FROM DATE 2027-01-01 OVER 12 months EVERY 1 month",
        ),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect(st.expr.vesting_start).toMatchObject({
        type: "Unqualified",
        anchor: { type: "Date", value: "2027-01-01" },
      });
    });

    it("VEST SCHEDULE FROM EVENT ipo", () => {
      const st = normalizeStatement(
        parseOne("VEST SCHEDULE FROM EVENT ipo OVER 12 months EVERY 1 month"),
      );
      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect(st.expr.vesting_start).toMatchObject({
        type: "Unqualified",
        anchor: { type: "Event", value: "ipo" },
      });
    });

    it("VEST SCHEDULE FROM EARLIER OF (DATE 2026-06-01, EVENT cic)", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST SCHEDULE FROM EARLIER OF (DATE 2026-06-01, EVENT cic) OVER 12 months EVERY 1 month",
        ),
      );
      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect("items" in st.expr.vesting_start).toBe(true);
      if ("items" in st.expr.vesting_start) {
        expect(st.expr.vesting_start.type).toBe("EarlierOf");
        expect(st.expr.vesting_start.items).toHaveLength(2);
      }
    });

    it("VEST SCHEDULE FROM LATER OF (EVENT ipo, DATE 2026-01-01)", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST SCHEDULE FROM LATER OF (EVENT ipo, DATE 2026-01-01) OVER 12 months EVERY 1 month",
        ),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect("items" in st.expr.vesting_start).toBe(true);
      if ("items" in st.expr.vesting_start) {
        expect(st.expr.vesting_start.type).toBe("LaterOf");
        expect(st.expr.vesting_start.items).toHaveLength(2);
      }
    });
  });

  describe("Qualified FROM (temporal predicates → Window)", () => {
    it("FROM DATE 2025-01-01 BEFORE EVENT cic", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST SCHEDULE FROM DATE 2025-01-01 BEFORE EVENT cic OVER 12 months EVERY 1 month",
        ),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      if ("items" in st.expr.vesting_start)
        throw new Error("unexpected combinator");
      expect(st.expr.vesting_start.type).toBe("Qualified");
      expect(st.expr.vesting_start.anchor).toEqual({
        type: "Date",
        value: "2025-01-01",
      });

      if (st.expr.vesting_start.type !== "Qualified")
        throw new Error("expected qualified window");
      expect(st.expr.vesting_start.window.end?.type).toBe("End");
      if (st.expr.vesting_start.window.end?.type === "End") {
        expect(st.expr.vesting_start.window.end.bound).toMatchObject({
          at: { type: "Event", value: "cic" },
          inclusive: true,
        });
      }
    });

    it("STRICTLY BEFORE toggles inclusivity", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST SCHEDULE FROM DATE 2025-01-01 STRICTLY BEFORE EVENT cic OVER 12 months EVERY 1 month",
        ),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      if (st.expr.vesting_start.type !== "Qualified")
        throw new Error("expected Qualified");
      if (st.expr.vesting_start.window.end?.type !== "End")
        throw new Error("expected End");
      expect(st.expr.vesting_start.window.end.bound.inclusive).toBe(false);
    });

    it("AFTER DATE 2026-01-01 on an EVENT base", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST SCHEDULE FROM EVENT ipo AFTER DATE 2026-01-01 OVER 12 months EVERY 1 month",
        ),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      const vs = st.expr.vesting_start;
      if (vs.type !== "Qualified") throw new Error("expected Qualified");
      expect(vs.anchor).toEqual({ type: "Event", value: "ipo" });
      expect(vs.window.start?.type).toBe("Start");
      if (vs.window.start?.type === "Start") {
        expect(vs.window.start.bound).toMatchObject({
          at: { type: "Date", value: "2026-01-01" },
          inclusive: true,
        });
      }
    });

    it("BETWEEN / STRICTLY BETWEEN", () => {
      const st1 = normalizeStatement(
        parseOne(
          "VEST SCHEDULE FROM EVENT board BETWEEN DATE 2025-01-01 AND DATE 2025-12-31 OVER 12 months EVERY 1 month",
        ),
      );

      if (st1.expr.type !== "Schedule")
        throw new Error("unexpected combinator");
      const vs1 = st1.expr.vesting_start;
      if (vs1.type !== "Qualified") throw new Error("expected Qualified");
      expect(vs1.window.start?.type).toBe("Start");
      expect(vs1.window.end?.type).toBe("End");
      if (vs1.window.start?.type === "Start")
        expect(vs1.window.start.bound.inclusive).toBe(true);
      if (vs1.window.end?.type === "End")
        expect(vs1.window.end.bound.inclusive).toBe(true);

      const st2 = normalizeStatement(
        parseOne(
          "VEST SCHEDULE FROM EVENT board STRICTLY BETWEEN DATE 2025-01-01 AND DATE 2025-12-31 OVER 12 months EVERY 1 month",
        ),
      );

      if (st2.expr.type !== "Schedule")
        throw new Error("unexpected combinator");
      const vs2 = st2.expr.vesting_start;
      if (vs2.type !== "Qualified") throw new Error("expected Qualified");
      if (vs2.window.start?.type === "Start")
        expect(vs2.window.start.bound.inclusive).toBe(false);
      if (vs2.window.end?.type === "End")
        expect(vs2.window.end.bound.inclusive).toBe(false);
    });

    it("Multiple predicates with AND are accumulated", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST SCHEDULE FROM EVENT board BEFORE DATE 2025-01-01 AND STRICTLY AFTER DATE 2025-12-31 OVER 12 months EVERY 1 month",
        ),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      const vs = st.expr.vesting_start;
      if (vs.type !== "Qualified") throw new Error("expected Qualified");
      // one end (before 2025-01-01) and one start (strictly after 2025-12-31)
      expect(vs.window.end?.type).toBe("End");
      expect(vs.window.start?.type).toBe("Start");
    });
  });

  describe("CLIFF forms", () => {
    it("CLIFF 0 months (no-op for months periodicity)", () => {
      const st = normalizeStatement(
        parseOne("VEST SCHEDULE OVER 12 months EVERY 1 month CLIFF 0 months"),
      );
      expectMonthsPeriodicity(st.expr, 12, 1, 12);

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect((st.expr.periodicity as any).cliff ?? 0).toBe(0);
    });

    it("CLIFF 6 months", () => {
      const st = normalizeStatement(
        parseOne("VEST SCHEDULE OVER 12 months EVERY 1 month CLIFF 6 months"),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect((st.expr.periodicity as any).cliff).toBe(6);
    });

    it("CLIFF DATE 2026-03-01 (LaterOf with FROM)", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST SCHEDULE FROM DATE 2026-01-01 OVER 30 days EVERY 10 days CLIFF DATE 2026-03-01",
        ),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect("items" in st.expr.vesting_start).toBe(true);
      if ("items" in st.expr.vesting_start) {
        expect(st.expr.vesting_start.type).toBe("LaterOf");
        expect(st.expr.vesting_start.items).toHaveLength(2);
      }
    });

    it("CLIFF EVENT hire BEFORE EVENT cic (Qualified cliff)", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST SCHEDULE FROM EVENT ipo OVER 12 months EVERY 1 month CLIFF EVENT hire BEFORE EVENT cic",
        ),
      );
      // outer is LaterOf(FROM, cliffQualified)

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect("items" in st.expr.vesting_start).toBe(true);
      if ("items" in st.expr.vesting_start) {
        const [, right] = st.expr.vesting_start.items;
        expect("items" in right).toBe(false); // right is a Qualified leaf
        expect(right.type).toBe("Qualified");
        expect((right as any).window.end?.type).toBe("End");
      }
    });

    it("CLIFF EARLIER OF (...)", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST SCHEDULE OVER 12 months EVERY 1 month CLIFF EARLIER OF (EVENT ipo, DATE 2026-01-01)",
        ),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect("items" in st.expr.vesting_start).toBe(true);
      if ("items" in st.expr.vesting_start) {
        const [, right] = st.expr.vesting_start.items;
        expect("items" in right).toBe(true);
        if ("items" in right) expect(right.type).toBe("EarlierOf");
      }
    });

    it("CLIFF LATER OF (...)", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST SCHEDULE OVER 12 months EVERY 1 month CLIFF LATER OF (EVENT ipo, DATE 2026-01-01)",
        ),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect("items" in st.expr.vesting_start).toBe(true);
      if ("items" in st.expr.vesting_start) {
        const [, right] = st.expr.vesting_start.items;
        expect("items" in right).toBe(true);
        if ("items" in right) expect(right.type).toBe("LaterOf");
      }
    });
  });

  describe("Schedule combinators", () => {
    it(`VEST EARLIER OF ( SCHEDULE FROM DATE 2025-01-01 OVER 12 months EVERY 1 month, SCHEDULE FROM DATE 2025-06-01 )`, () => {
      const st = normalizeStatement(
        parseOne(`
        VEST EARLIER OF (
          SCHEDULE FROM DATE 2025-01-01 OVER 12 months EVERY 1 month,
          SCHEDULE FROM DATE 2025-06-01
        )
      `),
      );
      expect(st.expr.type).toBe("EarlierOfSchedules");
      expect((st.expr as any).items.length).toBe(2);
    });

    it(`VEST LATER OF ( SCHEDULE FROM DATE 2025-01-01, SCHEDULE FROM DATE 2025-06-01 OVER 6 months EVERY 1 month )`, () => {
      const st = normalizeStatement(
        parseOne(`
        VEST LATER OF (
          SCHEDULE FROM DATE 2025-01-01,
          SCHEDULE FROM DATE 2025-06-01 OVER 6 months EVERY 1 month
        )
      `),
      );
      expect(st.expr.type).toBe("LaterOfSchedules");
      expect((st.expr as any).items.length).toBe(2);
    });

    it("VEST EARLIER OF ( SCHEDULE, SCHEDULE ,  SCHEDULE )", () => {
      const st = normalizeStatement(
        parseOne("VEST EARLIER OF ( SCHEDULE, SCHEDULE ,  SCHEDULE )"),
      );
      expect(st.expr.type).toBe("EarlierOfSchedules");
      expect((st.expr as any).items.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Odds & ends", () => {
    it("VEST SCHEDULE FROM EVENT cic_phase2", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST SCHEDULE FROM EVENT cic_phase2 OVER 12 months EVERY 1 month",
        ),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      if ("items" in st.expr.vesting_start)
        throw new Error("unexpected combinator");
      expect(st.expr.vesting_start).toMatchObject({
        type: "Unqualified",
        anchor: { type: "Event", value: "cic_phase2" },
      });
    });

    it("Case-insensitivity works", () => {
      const a = normalizeStatement(
        parseOne(
          "Vest schedule from event ipo before date 2025-01-01 over 12 months every 1 month",
        ),
      );
      const b = normalizeStatement(
        parseOne(
          "vest schedule from event ipo after date 2025-01-01 over 12 months every 1 month",
        ),
      );
      const c = normalizeStatement(
        parseOne(
          "vest schedule from event ipo before earlier of (event a, event b) over 12 months every 1 month",
        ),
      );

      expect(a.expr.type).toBe("Schedule");
      expect(b.expr.type).toBe("Schedule");
      expect(c.expr.type).toBe("Schedule");

      // Quick spot check on windows:

      if (a.expr.type !== "Schedule") throw new Error("unexpected combinator");
      if (a.expr.vesting_start.type !== "Qualified")
        throw new Error("expected Qualified");
      expect(a.expr.vesting_start.window.end?.type).toBe("End");

      if (b.expr.type !== "Schedule") throw new Error("unexpected combinator");
      if (b.expr.vesting_start.type !== "Qualified")
        throw new Error("expected Qualified");
      expect(b.expr.vesting_start.window.start?.type).toBe("Start");

      if (c.expr.type !== "Schedule") throw new Error("unexpected combinator");
      if (c.expr.vesting_start.type !== "Qualified")
        throw new Error("expected Qualified");
      expect(c.expr.vesting_start.window.end?.type).toBe("EarlierOf");
    });
  });

  describe("Edge/unit support (current behavior)", () => {
    it("VEST SCHEDULE FROM DATE 2026-01-01", () => {
      // Needs OVER/EVERY; the normalizer requires both.
      expect(() =>
        normalizeStatement(parseOne("VEST SCHEDULE FROM DATE 2026-01-01")),
      ).toThrowError(NormalizerError);
    });

    it("VEST SCHEDULE OVER 0 days EVERY 0 days (allowed; count coerces to 1)", () => {
      const st = normalizeStatement(
        parseOne("VEST SCHEDULE OVER 0 days EVERY 0 days"),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect(st.expr.periodicity.periodType).toBe("DAYS");
      expect(st.expr.periodicity.span).toBe(0);
      expect(st.expr.periodicity.step).toBe(0);
      expect(st.expr.periodicity.count).toBe(1);
    });

    it("VEST SCHEDULE OVER 2 years EVERY 1 week (currently unsupported units)", () => {
      expect(() =>
        normalizeStatement(parseOne("VEST SCHEDULE OVER 2 years EVERY 1 week")),
      ).toThrowError(NormalizerError);
    });
  });
});
