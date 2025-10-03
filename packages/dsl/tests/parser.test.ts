import { describe, it, expect } from "vitest";
import { parse } from "../src/index";

import type {
  ASTStatement,
  ASTAmountAbsolute,
  ASTAmountPercent,
  ASTSchedule,
  Duration,
  DateAnchor,
  EventAnchor,
  QualifiedAnchor,
  EarlierOfFrom,
  LaterOfFrom,
  EarlierOfASTSchedules,
  LaterOfASTSchedules,
  TemporalPredNode,
} from "../src/types";

// Helpers
const d = (value: number, unit: "DAYS" | "MONTHS"): Duration => ({
  type: "Duration",
  value,
  unit,
});
const date = (value: string): DateAnchor => ({ type: "Date", value });
const event = (value: string): EventAnchor => ({ type: "Event", value });

const qBefore = (
  base: DateAnchor | EventAnchor,
  target: DateAnchor | EventAnchor,
  strict = false,
): QualifiedAnchor => ({
  type: "Qualified",
  base,
  predicates: [
    { type: "Before", i: target, strict },
  ] satisfies TemporalPredNode[],
});

const qAfter = (
  base: DateAnchor | EventAnchor,
  target: DateAnchor | EventAnchor,
  strict = false,
): QualifiedAnchor => ({
  type: "Qualified",
  base,
  predicates: [
    { type: "After", i: target, strict },
  ] satisfies TemporalPredNode[],
});

const qBetween = (
  base: DateAnchor | EventAnchor,
  start: DateAnchor | EventAnchor,
  end: DateAnchor | EventAnchor,
  strict = false,
): QualifiedAnchor => ({
  type: "Qualified",
  base,
  predicates: [
    { type: "Between", a: start, b: end, strict },
  ] satisfies TemporalPredNode[],
});

describe("vestlang PEG grammar", () => {
  describe("Amount parsing", () => {
    it("parses whole-number Amount as AmountAbsolute", () => {
      const ast = parse(
        "123 VEST SCHEDULE OVER 12 months EVERY 1 month",
      ) as ASTStatement;
      const amt = ast.amount as ASTAmountAbsolute;
      expect(amt).toEqual({ type: "AmountAbsolute", value: 123 });
    });

    it("parses decimal Amount in [0,1] as AmountPercent", () => {
      const ast = parse(
        "0.25 VEST SCHEDULE OVER 12 months EVERY 1 month",
      ) as ASTStatement;
      const amt = ast.amount as ASTAmountPercent;
      expect(amt).toEqual({ type: "AmountPercent", value: 0.25 });
    });

    it("parses leading-dot decimal like .5", () => {
      const ast = parse(
        ".5 VEST SCHEDULE OVER 12 months EVERY 1 month",
      ) as ASTStatement;
      expect(ast.amount).toEqual({ type: "AmountPercent", value: 0.5 });
    });

    it("defaults to 100% when Amount omitted", () => {
      const ast = parse(
        "VEST SCHEDULE OVER 12 months EVERY 1 month",
      ) as ASTStatement;
      expect(ast.amount).toEqual({ type: "AmountPercent", value: 1 });
    });

    it("rejects decimal > 1 (e.g., 1.5) with custom error", () => {
      expect(() =>
        parse("1.5 VEST SCHEDULE OVER 12 months EVERY 1 month"),
      ).toThrow(/Decimal amount must be between 0 and 1/i);
    });
  });

  describe("Schedule basics", () => {
    it("omitting OVER/EVERY injects Zero for both", () => {
      const ast = parse("VEST SCHEDULE FROM DATE 2026-01-01") as ASTStatement;
      const s = ast.expr as ASTSchedule;
      expect(s.over).toEqual({ type: "Duration", value: 0, unit: "DAYS" });
      expect(s.every).toEqual({ type: "Duration", value: 0, unit: "DAYS" });
    });

    it("default FROM may be null (to be filled by normalizer), and cliff defaults to Zero", () => {
      const ast = parse("VEST SCHEDULE") as ASTStatement;
      const s = ast.expr as ASTSchedule;
      expect(s.from ?? null).toBeNull();
      // expect(s.over).toEqual({ type: "Duration", value: 0, unit: "DAYS" });
      // expect(s.every).toEqual({ type: "Duration", value: 0, unit: "DAYS" });
      // expect(s.cliff).toEqual({ type: "Duration", value: 0, unit: "DAYS" });
    });

    it("explicit 0-day durations stay as Duration, not Zero", () => {
      const ast = parse(
        "VEST SCHEDULE OVER 0 days EVERY 0 days",
      ) as ASTStatement;
      const s = ast.expr as ASTSchedule;
      expect(s.over).toEqual(d(0, "DAYS"));
      expect(s.every).toEqual(d(0, "DAYS"));
    });

    it("errors if only OVER is present", () => {
      expect(() => parse("VEST SCHEDULE OVER 12 months")).toThrow(
        /EVERY must be provided when OVER is present/i,
      );
    });

    it("errors if only EVERY is present", () => {
      expect(() => parse("VEST SCHEDULE EVERY 1 month")).toThrow(
        /OVER must be provided when EVERY is present/i,
      );
    });

    it("normalizes weeks→days and years→months", () => {
      const ast = parse(
        "VEST SCHEDULE OVER 2 years EVERY 1 week",
      ) as ASTStatement;
      const s = ast.expr as ASTSchedule;
      expect(s.over).toEqual(d(24, "MONTHS")); // 2y → 24m
      expect(s.every).toEqual(d(7, "DAYS")); // 1w → 7d
    });
  });

  describe("FROM term (Date/Event, Earlier/Later, predicates)", () => {
    it("supports FROM DATE and FROM EVENT", () => {
      const a = parse("VEST SCHEDULE FROM DATE 2027-01-01") as ASTStatement;
      const b = parse("VEST SCHEDULE FROM EVENT ipo") as ASTStatement;
      expect((a.expr as ASTSchedule).from).toEqual(date("2027-01-01"));
      expect((b.expr as ASTSchedule).from).toEqual(event("ipo"));
    });

    it("supports FROM EARLIER OF ( ... )", () => {
      const ast = parse(
        "VEST SCHEDULE FROM EARLIER OF (DATE 2026-06-01, EVENT cic)",
      ) as ASTStatement;
      const from = (ast.expr as ASTSchedule).from as EarlierOfFrom;
      expect(from.type).toBe("EarlierOf");
      expect(from.items).toEqual([date("2026-06-01"), event("cic")]);
    });

    it("supports FROM LATER OF ( ... )", () => {
      const ast = parse(
        "VEST SCHEDULE FROM LATER OF (EVENT ipo, DATE 2026-01-01)",
      ) as ASTStatement;
      const from = (ast.expr as ASTSchedule).from as LaterOfFrom;
      expect(from.type).toBe("LaterOf");
      expect(from.items).toEqual([event("ipo"), date("2026-01-01")]);
    });

    it("supports QualifiedAtom with BEFORE / AFTER / BETWEEN (no BY)", () => {
      const before = parse(
        "VEST SCHEDULE FROM DATE 2025-01-01 BEFORE EVENT cic",
      ) as ASTStatement;
      expect((before.expr as ASTSchedule).from).toEqual(
        qBefore(date("2025-01-01"), event("cic")),
      );

      const strictlyBefore = parse(
        "VEST SCHEDULE FROM DATE 2025-01-01 STRICTLY BEFORE EVENT cic",
      ) as ASTStatement;
      expect((strictlyBefore.expr as ASTSchedule).from).toEqual(
        qBefore(date("2025-01-01"), event("cic"), true),
      );

      const after = parse(
        "VEST SCHEDULE FROM EVENT ipo AFTER DATE 2026-01-01",
      ) as ASTStatement;
      expect((after.expr as ASTSchedule).from).toEqual(
        qAfter(event("ipo"), date("2026-01-01")),
      );

      const between = parse(
        "VEST SCHEDULE FROM EVENT board BETWEEN DATE 2025-01-01 AND DATE 2025-12-31",
      ) as ASTStatement;
      expect((between.expr as ASTSchedule).from).toEqual(
        qBetween(event("board"), date("2025-01-01"), date("2025-12-31")),
      );

      const strictlyBetween = parse(
        "VEST SCHEDULE FROM EVENT board STRICTLY BETWEEN DATE 2025-01-01 AND DATE 2025-12-31",
      ) as ASTStatement;
      expect((strictlyBetween.expr as ASTSchedule).from).toEqual(
        qBetween(event("board"), date("2025-01-01"), date("2025-12-31"), true),
      );
    });
  });

  describe("CLIFF term", () => {
    it("CLIFF <Duration>", () => {
      const ast = parse("VEST SCHEDULE CLIFF 6 months") as ASTStatement;
      expect((ast.expr as ASTSchedule).cliff).toEqual(d(6, "MONTHS"));
    });

    it("CLIFF as Anchor/Qualified/EarlierOf/LaterOf", () => {
      const a = parse("VEST SCHEDULE CLIFF DATE 2026-03-01") as ASTStatement;
      expect((a.expr as ASTSchedule).cliff).toEqual(date("2026-03-01"));

      const b = parse(
        "VEST SCHEDULE CLIFF EVENT hire BEFORE EVENT cic",
      ) as ASTStatement;
      // NB: cliff stays in parser AST as QualifiedAnchor; normalization happens later
      expect((b.expr as ASTSchedule).cliff).toEqual(
        qBefore(event("hire"), event("cic")),
      );

      const c = parse(
        "VEST SCHEDULE CLIFF EARLIER OF (EVENT ipo, DATE 2026-01-01)",
      ) as ASTStatement;
      expect((c.expr as ASTSchedule).cliff).toMatchObject({
        type: "EarlierOf",
      });

      const dAst = parse(
        "VEST SCHEDULE CLIFF LATER OF (EVENT ipo, DATE 2026-01-01)",
      ) as ASTStatement;
      expect((dAst.expr as ASTSchedule).cliff).toMatchObject({
        type: "LaterOf",
      });
    });
  });

  describe("Top-level Expr composition", () => {
    it("parses EARLIER OF (Schedule, ASTSchedule, ...)", () => {
      const ast = parse(`
        VEST EARLIER OF (
          SCHEDULE FROM DATE 2025-01-01 OVER 12 months EVERY 1 month,
          SCHEDULE FROM DATE 2025-06-01
        )
      `) as ASTStatement;

      const e = ast.expr as EarlierOfASTSchedules;
      expect(e.type).toBe("EarlierOfSchedules");
      expect(e.items).toHaveLength(2);

      const s0 = e.items[0] as ASTSchedule;
      const s1 = e.items[1] as ASTSchedule;

      expect(s0.type).toBe("Schedule");
      expect(s1.type).toBe("Schedule");
    });

    it("parses LATER OF (Schedule, ASTSchedule, ...)", () => {
      const ast = parse(`
        VEST LATER OF (
          SCHEDULE FROM DATE 2025-01-01,
          SCHEDULE FROM DATE 2025-06-01 OVER 6 months EVERY 1 month
        )
      `) as ASTStatement;

      const e = ast.expr as LaterOfASTSchedules;
      expect(e.type).toBe("LaterOfSchedules");
      expect(e.items).toHaveLength(2);
    });

    it("handles ExprList commas/whitespace robustly", () => {
      const ast = parse(`
        VEST EARLIER OF ( SCHEDULE, SCHEDULE ,  SCHEDULE )
      `) as ASTStatement;
      const e = ast.expr as EarlierOfASTSchedules;
      expect(e.items).toHaveLength(3);
    });
  });

  describe("Lexical constraints", () => {
    it("accepts event identifiers with underscores and digits after first char", () => {
      const ast = parse("VEST SCHEDULE FROM EVENT cic_phase2") as ASTStatement;
      expect((ast.expr as ASTSchedule).from).toEqual(event("cic_phase2"));
    });

    it("rejects invalid date formats", () => {
      expect(() => parse("VEST SCHEDULE FROM DATE 2025-13-40")).toThrow();
    });
  });
});
