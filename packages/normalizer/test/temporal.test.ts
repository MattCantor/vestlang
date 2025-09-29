import { describe, it, expect } from "vitest";
import type { Anchor, TemporalPredNode } from "@vestlang/dsl";
import { lowerTemporalPredicates } from "../src/temporal";

// tiny helpers
const date = (iso: string): Anchor => ({ type: "Date", iso });
const event = (name: string): Anchor => ({ type: "Event", name });

describe("lowerTemporalPredicates", () => {
  it("returns unbounded inclusive when no predicates", () => {
    const win = lowerTemporalPredicates(undefined);
    expect(win).toEqual({ includeStart: true, includeEnd: true });
  });

  it("AFTER (inclusive) lowers to start with includeStart=true", () => {
    const preds: TemporalPredNode[] = [
      { type: "After", i: date("2025-01-01"), strict: false },
    ];
    const win = lowerTemporalPredicates(preds);
    expect(win).toEqual({
      start: date("2025-01-01"),
      includeStart: true,
      includeEnd: true,
    });
  });

  it("STRICTLY AFTER lowers to start with includeStart=false", () => {
    const preds: TemporalPredNode[] = [
      { type: "After", i: date("2025-01-01"), strict: true },
    ];
    const win = lowerTemporalPredicates(preds);
    expect(win).toEqual({
      start: date("2025-01-01"),
      includeStart: false,
      includeEnd: true,
    });
  });

  it("BEFORE (inclusive end) lowers with includeEnd=true", () => {
    const preds: TemporalPredNode[] = [
      { type: "Before", i: date("2025-12-31"), strict: false },
    ];
    const win = lowerTemporalPredicates(preds);
    expect(win).toEqual({
      end: date("2025-12-31"),
      includeStart: true,
      includeEnd: true,
    });
  });

  it("STRICTLY BEFORE lowers with includeEnd=false", () => {
    const preds: TemporalPredNode[] = [
      { type: "Before", i: date("2025-12-31"), strict: true },
    ];
    const win = lowerTemporalPredicates(preds);
    expect(win).toEqual({
      end: date("2025-12-31"),
      includeStart: true,
      includeEnd: false,
    });
  });

  it("BETWEEN lowers to inclusive both ends", () => {
    const preds: TemporalPredNode[] = [
      {
        type: "Between",
        a: date("2025-01-01"),
        b: date("2025-12-31"),
        strict: false,
      },
    ];
    const win = lowerTemporalPredicates(preds);
    expect(win).toEqual({
      start: date("2025-01-01"),
      end: date("2025-12-31"),
      includeStart: true,
      includeEnd: true,
    });
  });

  it("STRICTLY BETWEEN lowers to exclusive both ends", () => {
    const preds: TemporalPredNode[] = [
      {
        type: "Between",
        a: date("2025-01-01"),
        b: date("2025-12-31"),
        strict: true,
      },
    ];
    const win = lowerTemporalPredicates(preds);
    expect(win).toEqual({
      start: date("2025-01-01"),
      end: date("2025-12-31"),
      includeStart: false,
      includeEnd: false,
    });
  });

  it("AFTER A AND STRICTLY BEFORE B -> [A, B)", () => {
    const preds: TemporalPredNode[] = [
      { type: "After", i: date("2025-01-01"), strict: false },
      { type: "Before", i: date("2025-12-31"), strict: true },
    ];
    const win = lowerTemporalPredicates(preds);
    expect(win).toEqual({
      start: date("2025-01-01"),
      end: date("2025-12-31"),
      includeStart: true,
      includeEnd: false,
    });
  });

  it("STRICTLY AFTER A AND BEFORE B -> (A, B]", () => {
    const preds: TemporalPredNode[] = [
      { type: "After", i: date("2025-01-01"), strict: true },
      { type: "Before", i: date("2025-12-31"), strict: false },
    ];
    const win = lowerTemporalPredicates(preds);
    expect(win).toEqual({
      start: date("2025-01-01"),
      end: date("2025-12-31"),
      includeStart: false,
      includeEnd: true,
    });
  });

  it("Symbolic laterOf/earlierOf picks by ISO for Date vs Date", () => {
    const preds: TemporalPredNode[] = [
      { type: "After", i: date("2025-01-01"), strict: false },
      { type: "After", i: date("2025-03-01"), strict: false },
      { type: "Before", i: date("2025-12-31"), strict: false },
      { type: "Before", i: date("2025-10-31"), strict: false },
    ];
    // later start should be 2025-03-01; earlier end should be 2025-10-31
    const win = lowerTemporalPredicates(preds);
    expect(win.start).toEqual(date("2025-03-01"));
    expect(win.end).toEqual(date("2025-10-31"));
  });

  it("Symbolic compare for mixed anchors keeps deterministic left-pick", () => {
    const preds: TemporalPredNode[] = [
      { type: "After", i: event("ipo"), strict: false },
      { type: "After", i: date("2025-01-01"), strict: false },
    ];
    const win = lowerTemporalPredicates(preds);
    // With the current implementation, when comparing Event vs Date, laterOfSymbolic picks left.
    // So start should be the first anchor (EVENT ipo).
    expect(win.start).toEqual(event("ipo"));
    expect(win.includeStart).toBe(true);
  });
});
