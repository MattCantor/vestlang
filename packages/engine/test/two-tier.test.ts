import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { evaluate } from "../src";

const GRANT = new Date("2025-01-01T00:00:00Z");

describe("two-tier later-of(1y, CIC)", () => {
  const stmt = parse(`
    100 VEST
      SCHEDULE FROM grantDate OVER 4 years EVERY 1 month CLIFF 1 year
      IF ChangeInControl
  `);

  it("CIC @ 6m -> gate at 12m", () => {
    const out = evaluate(stmt, {
      events: {
        grantDate: GRANT,
        ChangeInControl: new Date("2025-07-01T00:00:00Z"),
      },
    });
    // first release at 2026-01-01 (12 months from grant)
    expect(out[0].at.toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("CIC @ 24m -> gate at 24m", () => {
    const out = evaluate(stmt, {
      events: {
        grantDate: GRANT,
        ChangeInControl: new Date("2027-01-01T00:00:00Z"),
      },
    });
    expect(out[0].at.toISOString().slice(0, 10)).toBe("2027-01-01");
  });
});
