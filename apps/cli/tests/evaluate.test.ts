import { afterEach, describe, expect, it } from "vitest";
import { evaluate } from "../src/evaluate.js";
import { spyConsoleAndExit, type Spies } from "./harness.js";

const HAPPY_DSL = "VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month";

const baseOpts = {
  quantity: "1200",
  grantDate: "2025-01-01",
  event: {} as Record<string, string>,
};

describe("evaluate action", () => {
  let spies: Spies;
  afterEach(() => spies?.restore());

  it("prints both verdict lines and a non-empty installment table", () => {
    spies = spyConsoleAndExit();
    evaluate([HAPPY_DSL], baseOpts);
    const out = spies.stdout();
    // The two side-by-side verdicts the action always renders.
    expect(out).toContain("storable:");
    expect(out).toContain("resolves to:");
    // console.table routes through console.log; a populated schedule shows its
    // column headers and at least one of the twelve monthly installments.
    expect(out).toContain("amount");
    expect(out).toContain("state");
    expect(out).toContain("RESOLVED");
  });

  it("routes an invalid quantity through fail() — error: line, exit 1", () => {
    spies = spyConsoleAndExit();
    expect(() =>
      evaluate([HAPPY_DSL], { ...baseOpts, quantity: "-5" }),
    ).toThrow(/__exit__:1/);
    expect(spies.stderr()).toMatch(/^error: /m);
    expect(spies.exitCode()).toBe(1);
  });

  it("routes an invalid grant date through fail() — error: line, exit 1", () => {
    spies = spyConsoleAndExit();
    expect(() =>
      evaluate([HAPPY_DSL], { ...baseOpts, grantDate: "not-a-date" }),
    ).toThrow(/__exit__:1/);
    expect(spies.stderr()).toMatch(/^error: /m);
    expect(spies.exitCode()).toBe(1);
  });
});
