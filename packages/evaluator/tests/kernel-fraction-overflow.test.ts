import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type { ResolvedInstallment } from "@vestlang/types";
import { evaluateProgram } from "../src/evaluate";

// Issue #512 — the kernel's internal share math overflowed the Number-backed
// Fraction guard when BOTH the statement's share of the grant and its cliff
// percentage were non-terminating 10-place truncations. `48 VEST OVER 12 months
// EVERY 2 months CLIFF 8 months` at a 97-share grant is the minimal repro:
//   - statement share 48/97 stores as "0.4948453608" (non-terminating),
//   - the bare 8-month cliff takes the pre-cliff grid share 4/6 = 2/3, stored
//     "0.6666666666" (non-terminating),
//   - fracMul of the two re-parsed Numerics drove a denominator past ~10^20 with
//     a numerator coprime to 10, so the Fraction guard threw
//     `fraction component exceeds Number.MAX_SAFE_INTEGER after reduction`.
// The fix moves that math to BigInt-exact rationals, so the template now
// evaluates. The stored 10-place semantics are unchanged: the truncated 48/97
// legitimately loses one share, so the stream sums to 47, not 48.

const DSL = "48 VEST OVER 12 months EVERY 2 months CLIFF 8 months";
const ctx = {
  grantDate: "2024-01-01" as const,
  events: {},
  grantQuantity: 97,
};

describe("kernel fraction overflow — both operands non-terminating (#512)", () => {
  it("evaluates to a template stream instead of throwing the MAX_SAFE overflow", () => {
    const schedule = evaluateProgram(normalizeProgram(parse(DSL)), ctx);
    expect(schedule.resolution.status).toBe("template");
    if (schedule.resolution.status !== "template")
      throw new Error("expected template");
    const resolved = schedule.resolution.installments.filter(
      (i): i is ResolvedInstallment => i.state === "RESOLVED",
    );
    // Cliff lump on 2024-09-01 (8 months in), then the two post-cliff bimonthly
    // occurrences. Sum 47 — the stored truncation of 48/97 drops one share.
    expect(resolved.map((i) => ({ date: i.date, amount: i.amount }))).toEqual([
      { date: "2024-09-01", amount: 31 },
      { date: "2024-11-01", amount: 8 },
      { date: "2025-01-01", amount: 8 },
    ]);
    expect(resolved.reduce((a, i) => a + i.amount, 0)).toBe(47);
  });
});
