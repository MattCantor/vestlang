import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { describe, expect, it } from "vitest";
import { hasEventBase } from "../src/gate.js";

const prog = (dsl: string) => normalizeProgram(parse(dsl));

// The gate's condition (3) hinges on finding an EVENT anchor *anywhere* it can
// hide — not just the start. These pin each hiding spot, including the one the
// linter's own walker stops short of (a condition's reference node).
describe("hasEventBase", () => {
  it("finds an event-anchored start", () => {
    const p = prog("400 VEST FROM EVENT ipo OVER 4 months EVERY 1 month");
    expect(hasEventBase(p)).toBe(true);
  });

  it("finds an event-gated cliff", () => {
    const p = prog(
      "100 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month CLIFF EVENT ipo",
    );
    expect(hasEventBase(p)).toBe(true);
  });

  it("finds an event inside a BEFORE condition's reference node", () => {
    // The start anchor is a DATE; the EVENT is buried in the constraint it's
    // gated by. This is the case a start+cliff peek (or the linter walker) misses.
    const p = prog(
      "400 VEST FROM DATE 2024-01-01 BEFORE EVENT ipo OVER 4 months EVERY 1 month",
    );
    expect(hasEventBase(p)).toBe(true);
  });

  it("finds an event in a LATER OF selector arm", () => {
    const p = prog(
      "400 VEST FROM LATER OF( DATE 2024-01-01, EVENT ipo ) OVER 4 months EVERY 1 month",
    );
    expect(hasEventBase(p)).toBe(true);
  });

  it("reports none for a pure-DATE program (the #43 shape)", () => {
    const p = prog(
      "0.5 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month PLUS 0.5 VEST FROM DATE 2024-03-01 OVER 4 months EVERY 1 month",
    );
    expect(hasEventBase(p)).toBe(false);
  });
});
