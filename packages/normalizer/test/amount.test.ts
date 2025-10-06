// packages/normalizer/test/amount.test.ts
import { describe, it, expect } from "vitest";
import { normalizeStatement } from "../src/normalizer";
import { NormalizerError } from "../src/errors";
import { createEvent, createSchedule, createStatement } from "./helpers";

describe("Amount normalization", () => {
  it("AmountAbsolute requires a numeric value", () => {
    const ast = createSchedule(12, 1, "MONTHS", createEvent("grantDate"));
    expect(() =>
      normalizeStatement(
        // @ts-expect-error testing invalid shape
        createStatement(ast, { type: "AmountAbsolute", value: "100" }),
      ),
    ).toThrowError(NormalizerError);

    const ok = normalizeStatement(
      createStatement(ast, { type: "AmountAbsolute", value: 100 }),
    );
    expect(ok.amount).toEqual({ type: "AmountAbsolute", value: 100 });
  });

  it("AmountPercent accepts fraction [0,1] and percentage (1..100]", () => {
    const ast = createSchedule(12, 1, "MONTHS", createEvent("grantDate"));

    const frac = normalizeStatement(
      createStatement(ast, { type: "AmountPercent", value: 0.25 }),
    ).amount as any;
    expect(frac.type).toBe("AmountPercent");
    expect(frac.numerator).toBe("25");
    expect(frac.denominator).toBe("100");

    const pct = normalizeStatement(
      createStatement(ast, { type: "AmountPercent", value: 25 }),
    ).amount as any;
    expect(pct.type).toBe("AmountPercent");
    expect(pct.numerator).toBe("25");
    expect(pct.denominator).toBe("100");

    expect(() =>
      normalizeStatement(
        createStatement(ast, { type: "AmountPercent", value: 150 }),
      ),
    ).toThrowError(NormalizerError);
  });

  it("AmountPercent passes through idempotent numerator/denominator", () => {
    const ast = createSchedule(12, 1, "MONTHS", createEvent("grantDate"));
    const amt = {
      type: "AmountPercent",
      numerator: "33",
      denominator: "100",
    } as const;

    const out = normalizeStatement(createStatement(ast, amt)).amount as any;
    expect(out).toEqual(amt);
  });
});
