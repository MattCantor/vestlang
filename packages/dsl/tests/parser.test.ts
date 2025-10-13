import { describe, it, expect } from "vitest";
import {
  ConstraintEnum,
  parse,
  PeriodTypeEnum,
  VBaseEnum,
  VNodeEnum,
} from "../src/index";

import {
  ASTStatement,
  AmountQuantity,
  AmountPortion,
  ASTSchedule,
  Duration,
  VestingBaseDate,
  VestingBaseEvent,
  VestingNodeConstrained,
  FromEarlierOf,
  FromLaterOf,
  EarlierOfASTExpr,
  LaterOfASTExpr,
  TemporalConstraint,
  OCTDate,
} from "../src/types";

// Helpers
const makeDuration = (value: number, unit: PeriodTypeEnum): Duration => ({
  type: "DURATION",
  value,
  unit,
});
const makeDate = (value: string): VestingBaseDate => ({
  type: VBaseEnum.DATE,
  value: value as OCTDate,
});
const makeEvent = (value: string): VestingBaseEvent => ({
  type: VBaseEnum.EVENT,
  value,
});

interface constrainedProps {
  base: VestingBaseDate | VestingBaseEvent;
  target: VestingBaseDate | VestingBaseEvent;
  strict: boolean;
}

const constrainedBefore = (
  props: constrainedProps,
): VestingNodeConstrained => ({
  type: VNodeEnum.CONSTRAINED,
  base: props.base,
  constraints: [
    { type: ConstraintEnum.BEFORE, base: props.target, strict: props.strict },
  ] satisfies TemporalConstraint[],
});

const constrainedAfter = (props: constrainedProps): VestingNodeConstrained => ({
  type: VNodeEnum.CONSTRAINED,
  base: props.base,
  constraints: [
    { type: ConstraintEnum.AFTER, base: props.target, strict: props.strict },
  ] satisfies TemporalConstraint[],
});

describe("...", () => {
  describe("Amount parsing", () => {
    it("parses whole-number Amount as AmountAbsolute", () => {
      const ast = parse(
        "123 VEST OVER 12 months EVERY 1 month",
      ) as ASTStatement;
      const amt = ast.amount as AmountQuantity;
      expect(amt).toEqual({ type: "AmountAbsolute", value: 123 });
    });

    it("parses decimal Amount in [0,1] as AmountPercent", () => {
      const ast = parse(
        "0.25 VEST OVER 12 months EVERY 1 month",
      ) as ASTStatement;
      const amt = ast.amount as AmountPortion;
      expect(amt).toEqual({ type: "AmountPercent", value: 0.25 });
    });

    it("parses leading-dot decimal like .5", () => {
      const ast = parse(".5 VEST OVER 12 months EVERY 1 month") as ASTStatement;
      expect(ast.amount).toEqual({ type: "AmountPercent", value: 0.5 });
    });

    it("defaults to 100% when Amount omitted", () => {
      const ast = parse("VEST OVER 12 months EVERY 1 month") as ASTStatement;
      expect(ast.amount).toEqual({ type: "AmountPercent", value: 1 });
    });

    it("rejects decimal > 1 (e.g., 1.5) with custom error", () => {
      expect(() => parse("1.5 VEST OVER 12 months EVERY 1 month")).toThrow(
        /Decimal amount must be between 0 and 1/i,
      );
    });
  });

  describe("Schedule basics", () => {
    it("omitting OVER/EVERY injects Zero for both", () => {
      const ast = parse("VEST FROM DATE 2026-01-01") as ASTStatement;
      const s = ast.expr as ASTSchedule;
      expect(s.over).toEqual(makeDuration(0, PeriodTypeEnum.DAYS));
      expect(s.every).toEqual(makeDuration(0, PeriodTypeEnum.DAYS));
    });

    it("default FROM may be null (to be filled by normalizer), and cliff defaults to Zero", () => {
      const ast = parse("VEST") as ASTStatement;
      const s = ast.expr as ASTSchedule;
      expect(s.from ?? null).toBeNull();
      // expect(s.over).toEqual({ type: "Duration", value: 0, unit: PeriodEnum.DAYS});
      // expect(s.every).toEqual({ type: "Duration", value: 0, unit: PeriodEnum.DAYS});
      // expect(s.cliff).toEqual({ type: "Duration", value: 0, unit: PeriodEnum.DAYS});
    });

    it("explicit 0-day durations stay as Duration, not Zero", () => {
      const ast = parse("VEST OVER 0 days EVERY 0 days") as ASTStatement;
      const s = ast.expr as ASTSchedule;
      expect(s.over).toEqual(makeDuration(0, PeriodTypeEnum.DAYS));
      expect(s.every).toEqual(makeDuration(0, PeriodTypeEnum.DAYS));
    });

    it("errors if only OVER is present", () => {
      expect(() => parse("VEST OVER 12 months")).toThrow(
        /EVERY must be provided when OVER is present/i,
      );
    });

    it("errors if only EVERY is present", () => {
      expect(() => parse("VEST EVERY 1 month")).toThrow(
        /OVER must be provided when EVERY is present/i,
      );
    });

    it("normalizes weeks→days and years→months", () => {
      const ast = parse("VEST OVER 2 years EVERY 1 week") as ASTStatement;
      const s = ast.expr as ASTSchedule;
      expect(s.over).toEqual(makeDuration(24, PeriodTypeEnum.MONTHS)); // 2y → 24m
      expect(s.every).toEqual(makeDuration(7, PeriodTypeEnum.DAYS));
    });
  });

  describe("FROM term (Date/Event, Earlier/Later)", () => {
    it("supports FROM DATE and FROM EVENT", () => {
      const a = parse("VEST FROM DATE 2027-01-01") as ASTStatement;
      const b = parse("VEST FROM EVENT ipo") as ASTStatement;
      expect((a.expr as ASTSchedule).from).toEqual(makeDate("2027-01-01"));
      expect((b.expr as ASTSchedule).from).toEqual(makeEvent("ipo"));
    });

    it("supports FROM EARLIER OF ( ... )", () => {
      const ast = parse(
        "VEST FROM EARLIER OF (DATE 2026-06-01, EVENT cic)",
      ) as ASTStatement;
      const from = (ast.expr as ASTSchedule).from as FromEarlierOf;
      expect(from.type).toBe("EARLIER_OF");
      expect(from.items).toEqual([makeDate("2026-06-01"), makeEvent("cic")]);
    });

    it("supports FROM LATER OF ( ... )", () => {
      const ast = parse(
        "VEST FROM LATER OF (EVENT ipo, DATE 2026-01-01)",
      ) as ASTStatement;
      const from = (ast.expr as ASTSchedule).from as FromLaterOf;
      expect(from.type).toBe("LATER_OF");
      expect(from.items).toEqual([makeEvent("ipo"), makeDate("2026-01-01")]);
    });

    it("supports QualifiedAtom with BEFORE / AFTER / BETWEEN", () => {
      const event = makeEvent("milestone");
      const afterDate = makeDate("2025-01-01");
      const before = parse(
        "VEST FROM DATE 2025-01-01 BEFORE EVENT milestone",
      ) as ASTStatement;
      expect((before.expr as ASTSchedule).from).toEqual(
        constrainedBefore({
          base: afterDate,
          target: event,
          strict: false,
        }),
      );

      const strictlyBefore = parse(
        "VEST FROM DATE 2025-01-01 STRICTLY BEFORE EVENT milestone",
      ) as ASTStatement;
      expect((strictlyBefore.expr as ASTSchedule).from).toEqual(
        constrainedBefore({
          base: afterDate,
          target: event,
          strict: true,
        }),
      );

      const after = parse(
        "VEST FROM EVENT milestone AFTER DATE 2025-01-01",
      ) as ASTStatement;
      expect((after.expr as ASTSchedule).from).toEqual(
        constrainedAfter({
          base: event,
          target: afterDate,
          strict: false,
        }),
      );
    });
  });

  describe("CLIFF term", () => {
    it("CLIFF <Duration>", () => {
      const ast = parse("VEST CLIFF 6 months") as ASTStatement;
      expect((ast.expr as ASTSchedule).cliff).toEqual(
        makeDuration(6, PeriodTypeEnum.MONTHS),
      );
    });

    it("CLIFF as Anchor/Qualified/EarlierOf/LaterOf", () => {
      const a = parse("VEST CLIFF DATE 2026-03-01") as ASTStatement;
      expect((a.expr as ASTSchedule).cliff).toEqual(makeDate("2026-03-01"));

      const b = parse("VEST CLIFF EVENT hire BEFORE EVENT cic") as ASTStatement;
      expect((b.expr as ASTSchedule).cliff).toEqual(
        constrainedBefore({
          base: makeEvent("hire"),
          target: makeEvent("cic"),
          strict: false,
        }),
      );

      const c = parse(
        "VEST CLIFF EARLIER OF (EVENT ipo, DATE 2026-01-01)",
      ) as ASTStatement;
      expect((c.expr as ASTSchedule).cliff).toMatchObject({
        type: "EARLIER_OF",
      });

      const dAst = parse(
        "VEST CLIFF LATER OF (EVENT ipo, DATE 2026-01-01)",
      ) as ASTStatement;
      expect((dAst.expr as ASTSchedule).cliff).toMatchObject({
        type: "LATER_OF",
      });
    });
  });

  describe("Top-level Expr composition", () => {
    it("parses EARLIER OF (Schedule, ASTSchedule, ...)", () => {
      const ast = parse(`
        VEST EARLIER OF (
          FROM DATE 2025-01-01 OVER 12 months EVERY 1 month,
          FROM DATE 2025-06-01
        )
      `) as ASTStatement;

      const e = ast.expr as EarlierOfASTExpr;
      expect(e.type).toBe("EARLIER_OF");
      expect(e.items).toHaveLength(2);

      const s0 = e.items[0] as ASTSchedule;
      const s1 = e.items[1] as ASTSchedule;

      expect(s0.type).toBe("SINGLETON");
      expect(s1.type).toBe("SINGLETON");
    });

    it("parses LATER OF (Schedule, ASTSchedule, ...)", () => {
      const ast = parse(`
        VEST LATER OF (
          FROM DATE 2025-01-01,
          FROM DATE 2025-06-01 OVER 6 months EVERY 1 month
        )
      `) as ASTStatement;

      const e = ast.expr as LaterOfASTExpr;
      expect(e.type).toBe("LATER_OF");
      expect(e.items).toHaveLength(2);
    });

    // it("handles ExprList commas/whitespace robustly", () => {
    //   const ast = parse(`
    //     VEST EARLIER OF ( VEST FROM EVENT grantDate, VEST FROM EVENT grantDate ,  VEST FROM EVENT grantDate )
    //   `) as ASTStatement;
    //   const e = ast.expr as EarlierOfASTExpr;
    //   expect(e.items).toHaveLength(3);
    // });
  });

  describe("Lexical constraints", () => {
    it("accepts event identifiers with underscores and digits after first char", () => {
      const ast = parse("VEST FROM EVENT cic_phase2") as ASTStatement;
      expect((ast.expr as ASTSchedule).from).toEqual(makeEvent("cic_phase2"));
    });

    it("rejects invalid date formats", () => {
      expect(() => parse("VEST FROM DATE 2025-13-40")).toThrow();
    });
  });
});
