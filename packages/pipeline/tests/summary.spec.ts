import { describe, it, expect } from "vitest";
import type { VestedResult } from "@vestlang/evaluator";
import type { Installment } from "@vestlang/types";
import { computeSummary, filterByWindow } from "../src/summary";

const resolved = (amount: number, date: string): Installment => ({
  amount,
  date,
  meta: { state: "RESOLVED" },
});

describe("computeSummary", () => {
  it("rolls up a half-vested, fully-resolved schedule", () => {
    const result: VestedResult = {
      vested: [resolved(100, "2025-01-01")],
      unvested: [resolved(100, "2025-06-01")],
      impossible: [],
      unresolved: 0,
    };
    const s = computeSummary(result, 200);
    expect(s.total_vested).toBe(100);
    expect(s.total_unvested).toBe(100);
    expect(s.percent_vested).toBe(0.5);
    expect(s.next_vest_date).toBe("2025-06-01");
    expect(s.next_vest_amount).toBe(100);
    expect(s.cliff_date).toBe("2025-01-01");
    expect(s.fully_vested_date).toBe("2025-06-01");
  });

  it("leaves fully_vested_date null while anything is unresolved", () => {
    const result: VestedResult = {
      vested: [resolved(100, "2025-01-01")],
      unvested: [],
      impossible: [],
      unresolved: 100,
    };
    const s = computeSummary(result, 200);
    expect(s.fully_vested_date).toBeNull();
    expect(s.total_unvested).toBe(100); // the unresolved quantity counts here
  });
});

describe("filterByWindow", () => {
  it("keeps resolved tranches inside [from, to] inclusive", () => {
    const vested = [
      resolved(100, "2024-12-31"),
      resolved(100, "2025-01-01"),
      resolved(100, "2025-12-31"),
      resolved(100, "2026-01-01"),
    ];
    const { installments, total } = filterByWindow(
      vested,
      "2025-01-01",
      "2025-12-31",
    );
    expect(installments).toHaveLength(2);
    expect(total).toBe(200);
  });
});
