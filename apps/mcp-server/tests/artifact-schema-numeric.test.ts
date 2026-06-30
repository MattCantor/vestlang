import { describe, expect, it } from "vitest";
import { PERSISTED_ARTIFACT } from "../src/artifact-schema.js";

// Issue #359 AC8 — the persist wire schema now holds a percentage as an OCF
// Numeric string. Hand-edited artifacts are untrusted, so the zod schema must
// accept a well-formed decimal and reject the old {numerator,denominator}
// object, scientific notation, and any string past ten decimal places.

const artifactWith = (percentage: unknown) => ({
  template: {
    object_type: "VESTING_TERMS",
    id: "t",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 1,
          period: 12,
          period_type: "MONTHS",
        },
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

// Issue #390 AC8 — the wire schema is a `z.union` of two `.strict()` arms that
// enforces the optional-schedule invariant on untrusted input. The
// `satisfies z.ZodType<PersistedArtifact>` pin is loose (Zod variance), so these
// safeParse cases are the load-bearing guard, not the typecheck.
describe("PERSISTED_ARTIFACT — optional-schedule invariant (#390 AC8)", () => {
  const artifact = (statement: unknown) => ({
    template: {
      object_type: "VESTING_TERMS",
      id: "t",
      statements: [statement],
    },
    runtime: { startDate: "2025-01-01" },
  });

  it("accepts a persisted pure milestone (no schedule, has event_condition)", () => {
    const res = PERSISTED_ARTIFACT.safeParse(
      artifact({
        order: 1,
        percentage: "1",
        event_condition: { event_id: "ipo" },
      }),
    );
    expect(res.success).toBe(true);
  });

  it("accepts a scheduled statement that also carries an event_condition (hybrid)", () => {
    const res = PERSISTED_ARTIFACT.safeParse(
      artifact({
        order: 1,
        percentage: "1",
        schedule: { occurrences: 48, period: 1, period_type: "MONTHS" },
        event_condition: { event_id: "ipo" },
      }),
    );
    expect(res.success).toBe(true);
  });

  it("rejects the neither-corner (no schedule, no event_condition)", () => {
    const res = PERSISTED_ARTIFACT.safeParse(
      artifact({ order: 1, percentage: "1" }),
    );
    expect(res.success).toBe(false);
  });

  it("rejects a milestone arm carrying a stray schedule key (the .strict() guard)", () => {
    // This object has both an event_condition AND a schedule, so it can only match
    // the scheduled arm — and there it is a valid hybrid. To exercise the
    // milestone arm's `.strict()` rejection of a stray key, smuggle a non-schema
    // key: only the milestone arm (no extra keys) and the scheduled arm (schedule
    // required) exist, so an event-only statement with an unexpected key matches
    // neither.
    const res = PERSISTED_ARTIFACT.safeParse(
      artifact({
        order: 1,
        percentage: "1",
        event_condition: { event_id: "ipo" },
        bogus: true,
      }),
    );
    expect(res.success).toBe(false);
  });
});

// `order` is a 1-based sequence position, so the wire schema rejects order < 1 —
// mirroring core validate.ts (`>= 1`) and the canonical interchange (OCF
// OCFVestingStatement.order, minimum: 1). Enforced on both union arms.
describe("PERSISTED_ARTIFACT — order is 1-based (>= 1)", () => {
  const artifact = (statement: unknown) => ({
    template: {
      object_type: "VESTING_TERMS",
      id: "t",
      statements: [statement],
    },
    runtime: { startDate: "2025-01-01" },
  });
  const milestone = (order: number) => ({
    order,
    percentage: "1",
    event_condition: { event_id: "ipo" },
  });
  const scheduled = (order: number) => ({
    order,
    percentage: "1",
    schedule: { occurrences: 1, period: 12, period_type: "MONTHS" },
  });

  it("rejects order 0 on both arms", () => {
    expect(PERSISTED_ARTIFACT.safeParse(artifact(milestone(0))).success).toBe(
      false,
    );
    expect(PERSISTED_ARTIFACT.safeParse(artifact(scheduled(0))).success).toBe(
      false,
    );
  });

  it("rejects a negative order", () => {
    expect(PERSISTED_ARTIFACT.safeParse(artifact(milestone(-1))).success).toBe(
      false,
    );
  });

  it("accepts order 1", () => {
    expect(PERSISTED_ARTIFACT.safeParse(artifact(milestone(1))).success).toBe(
      true,
    );
    expect(PERSISTED_ARTIFACT.safeParse(artifact(scheduled(1))).success).toBe(
      true,
    );
  });
});
