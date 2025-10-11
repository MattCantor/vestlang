import { describe, it, expect } from "vitest";
import { canonicalizeConstraints } from "../src/normalizer/constraints.js";

const D = (v: string) => ({ type: "Date" as const, value: v });
const E = (v: string) => ({ type: "Event" as const, value: v });
describe("AnyOf runtime asserts", () => {
  it("throws if AnyOf.anyOf contains a non-BaseConstraint", () => {
    const bad = [
      {
        type: "AnyOf" as const,
        // @ts-expect-error: intentionally malformed for runtime check
        anyOf: [
          { type: "BEFORE", anchor: D("2025-12-31"), strict: false },
          {
            type: "AnyOf",
            anyOf: [{ type: "After", anchor: D("2026-01-01"), strict: true }],
          }, // <- illegal nested AnyOf
        ],
      },
    ];

    expect(() => canonicalizeConstraints(bad as any)).toThrow();
  });

  it("throws if AnyOf.anyOf is empty or not an array", () => {
    const bad1 = [{ type: "AnyOf" as const, anyOf: [] as any }];
    expect(() => canonicalizeConstraints(bad1 as any)).toThrowError(
      /non-empty array/,
    );

    const bad2 = [{ type: "AnyOf" as const, anyOf: null as any }];
    expect(() => canonicalizeConstraints(bad2 as any)).toThrowError(
      /non-empty array/,
    );
  });
});

describe("constraints canonicalization", () => {
  it("sorts base constraints (Before < After, strict first, then anchor)", () => {
    const input = [
      { type: "AFTER", anchor: E("ipo"), strict: true },
      { type: "BEFORE", anchor: E("cic"), strict: false },
      { type: "BEFORE", anchor: D("2025-12-31"), strict: true },
    ] as const;

    const out = canonicalizeConstraints(input as any);
    expect(out).toEqual([
      { type: "BEFORE", anchor: D("2025-12-31"), strict: true },
      { type: "BEFORE", anchor: E("cic"), strict: false },
      { type: "AFTER", anchor: E("ipo"), strict: true },
    ]);
  });

  it("dedupes identical base constraints", () => {
    const input = [
      { type: "BEFORE", anchor: E("cic"), strict: false },
      { type: "BEFORE", anchor: E("cic"), strict: false }, // dup
    ] as const;

    const out = canonicalizeConstraints(input as any);
    expect(out).toEqual([{ type: "BEFORE", anchor: E("cic"), strict: false }]);
  });

  it("dedupes and sorts inside AnyOf; collapses singletons", () => {
    const input = [
      {
        type: "AnyOf",
        anyOf: [
          { type: "AFTER", anchor: D("2026-01-01"), strict: true },
          { type: "AFTER", anchor: D("2026-01-01"), strict: true }, // dup
        ],
      },
    ] as const;

    const out = canonicalizeConstraints(input as any);
    // AnyOf collapsed to its only member
    expect(out).toEqual([
      { type: "AFTER", anchor: D("2026-01-01"), strict: true },
    ]);
  });

  it("keeps AnyOf with 2+ unique members and sorts them", () => {
    const input = [
      {
        type: "AnyOf",
        anyOf: [
          { type: "AFTER", anchor: D("2026-01-01"), strict: true },
          { type: "BEFORE", anchor: D("2025-12-31"), strict: false },
        ],
      },
      { type: "BEFORE", anchor: E("cic"), strict: false },
    ] as const;

    const out = canonicalizeConstraints(input as any);
    expect(out).toEqual([
      { type: "BEFORE", anchor: E("cic"), strict: false },
      {
        type: "AnyOf",
        anyOf: [
          { type: "BEFORE", anchor: D("2025-12-31"), strict: false },
          { type: "AFTER", anchor: D("2026-01-01"), strict: true },
        ],
      },
    ]);
  });

  it("is idempotent", () => {
    const input = [
      { type: "BEFORE", anchor: E("cic"), strict: false },
      {
        type: "AnyOf",
        anyOf: [
          { type: "AFTER", anchor: D("2026-01-01"), strict: true },
          { type: "BEFORE", anchor: D("2025-12-31"), strict: false },
        ],
      },
      { type: "BEFORE", anchor: E("cic"), strict: false }, // dup
    ] as const;

    const once = canonicalizeConstraints(input as any);
    const twice = canonicalizeConstraints(once);
    expect(twice).toEqual(once);
  });
});
