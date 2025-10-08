import { describe, it, expect } from "vitest";
import { normalizeStatement } from "../src/normalizer";
import { NormalizerError } from "../src/errors";
import { expectMonthsPeriodicity, parseOne } from "./helpers";
import { Numeric } from "../src/types/oct-types";

describe("Integration: normalize DSL statements end-to-end", () => {
  describe("Amounts + simple schedules", () => {
    it("123 VEST OVER 12 months EVERY 1 month", () => {
      const st = normalizeStatement(
        parseOne("123 VEST OVER 12 months EVERY 1 month"),
      );
      expect(st.amount).toEqual({
        type: "AmountAbsolute",
        value: "123" as Numeric,
      });
      expectMonthsPeriodicity(st.expr, 12, 1, 12);
      // default FROM
      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect(st.expr.vesting_start).toMatchObject({
        id: "",
        type: "Bare",
        base: { type: "Event", value: "grantDate" },
      });
    });

    it("0.25 VEST OVER 12 months EVERY 1 month", () => {
      const st = normalizeStatement(
        parseOne("0.25 VEST OVER 12 months EVERY 1 month"),
      );
      expect(st.amount).toEqual({
        type: "AmountPercent",
        value: "25" as Numeric,
      });
      expectMonthsPeriodicity(st.expr, 12, 1, 12);
    });

    it(".5 VEST OVER 12 months EVERY 1 month", () => {
      const st = normalizeStatement(
        parseOne(".5 VEST OVER 12 months EVERY 1 month"),
      );
      expect(st.amount).toEqual({
        type: "AmountPercent",
        value: "50" as Numeric,
      });
      expectMonthsPeriodicity(st.expr, 12, 1, 12);
    });

    it("VEST OVER 12 months EVERY 1 month (implicit 100)", () => {
      const st = normalizeStatement(
        parseOne("VEST OVER 12 months EVERY 1 month"),
      );
      // parser typically emits { type: AmountAbsolute, value: 100 } or similar default.
      // We only assert the normalized shape is AmountAbsolute.
      expect(st.amount.type).toBe("AmountPercent");
      expectMonthsPeriodicity(st.expr, 12, 1, 12);
    });
  });

  describe("FROM variants (anchors & combinators)", () => {
    it("VEST FROM DATE 2027-01-01", () => {
      const st = normalizeStatement(
        parseOne("VEST FROM DATE 2027-01-01 OVER 12 months EVERY 1 month"),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect(st.expr.vesting_start).toMatchObject({
        id: "",
        type: "Bare",
        base: { type: "Date", value: "2027-01-01" },
      });
    });

    it("VEST FROM EVENT ipo", () => {
      const st = normalizeStatement(
        parseOne("VEST FROM EVENT ipo OVER 12 months EVERY 1 month"),
      );
      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect(st.expr.vesting_start).toMatchObject({
        type: "Bare",
        base: { type: "Event", value: "ipo" },
      });
    });

    it("VEST FROM EARLIER OF (DATE 2026-06-01, EVENT cic)", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST FROM EARLIER OF (DATE 2026-06-01, EVENT cic) OVER 12 months EVERY 1 month",
        ),
      );
      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect("items" in st.expr.vesting_start).toBe(true);
      if ("items" in st.expr.vesting_start) {
        expect(st.expr.vesting_start.type).toBe("EarlierOf");
        expect(st.expr.vesting_start.items).toHaveLength(2);
      }
    });

    it("VEST FROM LATER OF (EVENT ipo, DATE 2026-01-01)", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST FROM LATER OF (EVENT ipo, DATE 2026-01-01) OVER 12 months EVERY 1 month",
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
          "VEST FROM DATE 2025-01-01 BEFORE EVENT cic OVER 12 months EVERY 1 month",
        ),
      );
      console.log(st);
      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      if (st.expr.vesting_start.type !== "Constrained")
        throw new Error("unexpected unconstrained vesting start");
      expect(st.expr.vesting_start.type).toBe("Constrained");
      expect(st.expr.vesting_start.base).toEqual({
        type: "Date",
        value: "2025-01-01",
      });
    });

    it("STRICTLY BEFORE toggles inclusivity", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST FROM DATE 2025-01-01 STRICTLY BEFORE EVENT cic OVER 12 months EVERY 1 month",
        ),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      if (st.expr.vesting_start.type !== "Constrained")
        throw new Error("expected Qualified");
    });

    it("AFTER DATE 2026-01-01 on an EVENT base", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST FROM EVENT ipo AFTER DATE 2026-01-01 OVER 12 months EVERY 1 month",
        ),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      const vs = st.expr.vesting_start;
      if (vs.type !== "Constrained") throw new Error("expected Qualified");
      expect(vs.base).toEqual({ type: "Event", value: "ipo" });
    });

    it("BETWEEN / STRICTLY BETWEEN", () => {
      const st1 = normalizeStatement(
        parseOne(
          "VEST FROM EVENT board AFTER DATE 2025-01-01 AND BEFORE DATE 2025-12-31 OVER 12 months EVERY 1 month",
        ),
      );

      if (st1.expr.type !== "Schedule")
        throw new Error("unexpected combinator");
      const vs1 = st1.expr.vesting_start;
      if (vs1.type !== "Constrained") throw new Error("expected Constrained");

      const st2 = normalizeStatement(
        parseOne(
          "VEST FROM EVENT board STRICTLY AFTER DATE 2025-01-01 AND BEFORE DATE 2025-12-31 OVER 12 months EVERY 1 month",
        ),
      );

      if (st2.expr.type !== "Schedule")
        throw new Error("unexpected combinator");
      const vs2 = st2.expr.vesting_start;
      if (vs2.type !== "Constrained") throw new Error("expected Qualified");
    });
  });

  describe("CLIFF forms", () => {
    it("CLIFF 0 months (no-op for months periodicity)", () => {
      const st = normalizeStatement(
        parseOne("VEST OVER 12 months EVERY 1 month CLIFF 0 months"),
      );
      expectMonthsPeriodicity(st.expr, 12, 1, 12);

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect((st.expr.periodicity as any).cliff ?? 0).toStrictEqual({
        type: "Duration",
        value: 0,
        unit: "MONTHS",
      });
    });

    it("CLIFF 6 months", () => {
      const st = normalizeStatement(
        parseOne("VEST OVER 12 months EVERY 1 month CLIFF 6 months"),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect((st.expr.periodicity as any).cliff?.value).toBe(6);
    });

    // TODO: update normalizer to check that the cliff date falls on an installment date
    it("CLIFF DATE 2026-03-01 (LaterOf with FROM)", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST FROM DATE 2026-01-01 OVER 30 days EVERY 10 days CLIFF DATE 2026-03-01",
        ),
      );

      // if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      // expect("items" in st.expr.vesting_start).toBe(true);
      // if ("items" in st.expr.vesting_start) {
      //   expect(st.expr.vesting_start.type).toBe("LaterOf");
      //   expect(st.expr.vesting_start.items).toHaveLength(2);
      // }
    });

    it("CLIFF EVENT hire BEFORE EVENT cic (Qualified cliff)", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST FROM EVENT ipo OVER 12 months EVERY 1 month CLIFF EVENT hire BEFORE EVENT cic",
        ),
      );

      // if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      // expect("items" in st.expr.vesting_start).toBe(true);
      // if ("items" in st.expr.vesting_start) {
      //   const [, right] = st.expr.vesting_start.items;
      //   expect("items" in right).toBe(false); // right is a Qualified leaf
      //   expect(right.type).toBe("Qualified");
      //   expect((right as any).window.end?.type).toBe("End");
      // }
    });

    it("CLIFF EARLIER OF (...)", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST OVER 12 months EVERY 1 month CLIFF EARLIER OF (EVENT ipo, DATE 2026-01-01)",
        ),
      );

      // if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      // expect("items" in st.expr.vesting_start).toBe(true);
      // if ("items" in st.expr.vesting_start) {
      //   const [, right] = st.expr.vesting_start.items;
      //   expect("items" in right).toBe(true);
      //   if ("items" in right) expect(right.type).toBe("EarlierOf");
      // }
    });

    it("CLIFF LATER OF (...)", () => {
      const st = normalizeStatement(
        parseOne(
          "VEST OVER 12 months EVERY 1 month CLIFF LATER OF (EVENT ipo, DATE 2026-01-01)",
        ),
      );

      // if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      // expect("items" in st.expr.vesting_start).toBe(true);
      // if ("items" in st.expr.vesting_start) {
      //   const [, right] = st.expr.vesting_start.items;
      //   expect("items" in right).toBe(true);
      //   if ("items" in right) expect(right.type).toBe("LaterOf");
      // }
    });
  });

  describe("Schedule combinators", () => {
    it(`VEST EARLIER OF ( FROM DATE 2025-01-01 OVER 12 months EVERY 1 month, FROM DATE 2025-06-01 )`, () => {
      const st = normalizeStatement(
        parseOne(`
        VEST EARLIER OF ( FROM DATE 2025-01-01 OVER 12 months EVERY 1 month, FROM DATE 2025-06-01)
      `),
      );
      expect(st.expr.type).toBe("EarlierOf");
      expect((st.expr as any).items.length).toBe(2);
    });

    it(`VEST LATER OF ( FROM DATE 2025-01-01, FROM DATE 2025-06-01 OVER 6 months EVERY 1 month )`, () => {
      const st = normalizeStatement(
        parseOne(`
        VEST LATER OF (
          FROM DATE 2025-01-01,
          FROM DATE 2025-06-01 OVER 6 months EVERY 1 month
        )
      `),
      );
      expect(st.expr.type).toBe("LaterOf");
      expect((st.expr as any).items.length).toBe(2);
    });

    it("VEST EARLIER OF ( VEST, VEST, VEST )", () => {
      const st = normalizeStatement(
        parseOne("VEST EARLIER OF ( FROM EVENT milestone, FROM EVENT ipo )"),
      );
      expect(st.expr.type).toBe("EarlierOf");
      expect((st.expr as any).items.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Odds & ends", () => {
    it("VEST FROM EVENT cic_phase2", () => {
      const st = normalizeStatement(
        parseOne("VEST FROM EVENT cic_phase2 OVER 12 months EVERY 1 month"),
      );

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      if ("items" in st.expr.vesting_start)
        throw new Error("unexpected combinator");
      expect(st.expr.vesting_start).toMatchObject({
        id: "",
        type: "Bare",
        base: { type: "Event", value: "cic_phase2" },
      });
    });

    it("Case-insensitivity works", () => {
      const a = normalizeStatement(
        parseOne(
          "Vest from event ipo before date 2025-01-01 over 12 months every 1 month",
        ),
      );
      const b = normalizeStatement(
        parseOne(
          "vest from event ipo after date 2025-01-01 over 12 months every 1 month",
        ),
      );
      // TODO: Decide whether we want this following to parse. Currently it does not
      // const c = normalizeStatement(
      //   parseOne(
      //     "vest from event ipo before earlier of (event a, event b) over 12 months every 1 month",
      //   ),
      // );
      //
      expect(a.expr.type).toBe("Schedule");
      expect(b.expr.type).toBe("Schedule");
      // expect(c.expr.type).toBe("Schedule");

      // Quick spot check on windows:
    });
  });

  describe("Edge/unit support (current behavior)", () => {
    // it("VEST FROM DATE 2026-01-01", () => {
    // TODO: this needs to throw an error as a result of needing EVERY if OVER is provided.  there is a parsing error but no normalization error.
    // expect(() =>
    //   normalizeStatement(parseOne("VEST FROM DATE OVER 4 years 2026-01-01")),
    // ).toThrowError(NormalizerError);
    // });

    it("VEST OVER 0 days EVERY 0 days (allowed; count coerces to 1)", () => {
      const st = normalizeStatement(parseOne("VEST OVER 0 days EVERY 0 days"));

      if (st.expr.type !== "Schedule") throw new Error("unexpected combinator");
      expect(st.expr.periodicity.periodType).toBe("DAYS");
      expect(st.expr.periodicity.span).toBe(0);
      expect(st.expr.periodicity.step).toBe(0);
      expect(st.expr.periodicity.count).toBe(1);
    });
    // TODO: This throws a parse error but not a normalization error
    //   expect(() =>
    //     normalizeStatement(parseOne("VEST OVER 2 years EVERY 1 week")),
    //   ).toThrowError(NormalizerError);
    // });
  });
});
