import { describe, expect, it } from "vitest";
import { PERSISTED_ARTIFACT } from "../src/artifact-schema.js";

// Issue #359 AC8 — the persist wire schema now holds a percentage as an OCF
// Numeric string. Hand-edited artifacts are untrusted, so the zod schema must
// accept a well-formed decimal and reject the old {numerator,denominator}
// object, scientific notation, and any string past ten decimal places.

const artifactWith = (percentage: unknown) => ({
  template: {
    id: "t",
    statements: [
      {
        order: 1,
        occurrences: 1,
        period: 12,
        period_type: "MONTHS",
        percentage,
      },
    ],
  },
  runtime: { startDate: "2025-01-01" },
});

describe("PERSISTED_ARTIFACT — Numeric percentage on the wire (#359 AC8)", () => {
  it("accepts a well-formed Numeric percentage", () => {
    expect(PERSISTED_ARTIFACT.safeParse(artifactWith("0.25")).success).toBe(
      true,
    );
    expect(PERSISTED_ARTIFACT.safeParse(artifactWith("1")).success).toBe(true);
  });

  it("rejects a {numerator,denominator} object in a percentage position", () => {
    expect(
      PERSISTED_ARTIFACT.safeParse(
        artifactWith({ numerator: 1, denominator: 4 }),
      ).success,
    ).toBe(false);
  });

  it("rejects scientific notation", () => {
    expect(PERSISTED_ARTIFACT.safeParse(artifactWith("1e-5")).success).toBe(
      false,
    );
  });

  it("rejects a string past ten decimal places", () => {
    expect(
      PERSISTED_ARTIFACT.safeParse(artifactWith("0.12345678901")).success,
    ).toBe(false);
  });
});
