import { describe, it, expect } from "vitest";
import type {
  Anchor,
  Expr,
  Schedule,
  FromTerm,
  QualifiedAnchor,
  TemporalPredNode,
} from "@vestlang/dsl";
import { normalizeExpr, normalizeFromTerm } from "../src/from";

// helpers
const date = (iso: string): Anchor => ({ type: "Date", iso });
const event = (name: string): Anchor => ({ type: "Event", name });

describe("normalizeFromTerm", () => {
  it("defaults to grantDate + unbounded inclusive window when FROM is null", () => {
    const norm = normalizeFromTerm(null);
    expect(norm.base).toEqual(event("grantDate"));
    expect(norm.window).toEqual({ includeStart: true, includeEnd: true });
  });

  it("passes through bare Anchor with default window", () => {
    const anchor: FromTerm = date("2025-01-01");
    const norm = normalizeFromTerm(anchor);
    expect(norm.base).toEqual(date("2025-01-01"));
    expect(norm.window).toEqual({ includeStart: true, includeEnd: true });
  });

  it("lowers QualifiedAnchor predicates to a single TimeWindow", () => {
    const qa: QualifiedAnchor = {
      type: "Qualified",
      base: event("grant"),
      predicates: [
        { type: "After", i: date("2025-01-01"), strict: false },
        { type: "Before", i: date("2025-12-31"), strict: true },
      ] satisfies TemporalPredNode[],
    };
    const norm = normalizeFromTerm(qa);
    expect(norm.base).toEqual(event("grant"));
    expect(norm.window).toEqual({
      start: date("2025-01-01"),
      end: date("2025-12-31"),
      includeStart: true,
      includeEnd: false,
    });
  });

  it("passes through EarlierOf/LaterOf as base with default window", () => {
    const node: FromTerm = {
      type: "EarlierOf",
      items: [event("ipo"), event("cic")],
    };
    const norm = normalizeFromTerm(node);
    expect(norm.base).toEqual(node);
    expect(norm.window).toEqual({ includeStart: true, includeEnd: true });
  });
});

describe("normalizeExpr", () => {
  it("normalizes a simple Schedule", () => {
    const s: Schedule = {
      type: "Schedule",
      from: {
        type: "Qualified",
        base: event("grant"),
        predicates: [{ type: "After", i: date("2025-01-01"), strict: false }],
      },
      over: { type: "Duration", value: 12, unit: "months" },
      every: { type: "Duration", value: 1, unit: "months" },
      cliff: { type: "Zero" },
    };
    const out = normalizeExpr(s);
    expect(out.type).toBe("Schedule");
    if (out.type === "Schedule") {
      expect(out.fromBase).toEqual(event("grant"));
      expect(out.fromWindow).toEqual({
        start: date("2025-01-01"),
        includeStart: true,
        includeEnd: true,
      });
      expect(out.over).toEqual({ type: "Duration", value: 12, unit: "months" });
      expect(out.every).toEqual({ type: "Duration", value: 1, unit: "months" });
    }
  });

  it("recurses into EarlierOfSchedules / LaterOfSchedules", () => {
    const e: Expr = {
      type: "EarlierOfSchedules",
      items: [
        {
          type: "Schedule",
          from: null,
          over: { type: "Duration", value: 0, unit: "days" },
          every: { type: "Duration", value: 0, unit: "days" },
          cliff: { type: "Zero" },
        },
        {
          type: "LaterOfSchedules",
          items: [
            {
              type: "Schedule",
              from: { type: "Qualified", base: event("grant"), predicates: [] },
              over: { type: "Duration", value: 6, unit: "months" },
              every: { type: "Duration", value: 1, unit: "months" },
              cliff: { type: "Zero" },
            },
          ],
        },
      ],
    };
    const out = normalizeExpr(e);
    expect(out.type).toBe("EarlierOfSchedules");
    // spot-check inner schedule normalization
    const inner = (out.items[1] as any).items[0];
    expect(inner.type).toBe("Schedule");
    expect(inner.fromBase).toEqual(event("grant"));
    expect(inner.fromWindow).toEqual({ includeStart: true, includeEnd: true });
  });
});
