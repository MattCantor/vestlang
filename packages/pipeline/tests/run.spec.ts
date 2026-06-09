import { describe, it, expect } from "vitest";
import {
  runEvaluate,
  runAsOf,
  runVestedBetween,
  type GrantInput,
  type Summary,
} from "../src/index";

const grant: GrantInput = {
  grant_date: "2025-01-01",
  grant_quantity: 1200,
};

const sumInstallments = (xs: { amount: number }[]) =>
  xs.reduce((a, x) => a + x.amount, 0);

describe("runEvaluate", () => {
  it("classifies a plain date-anchored schedule as a template", () => {
    const r = runEvaluate("VEST OVER 12 months EVERY 1 month", grant);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.resolution.status).toBe("template");
      expect(r.breakdown).toHaveLength(1);
    }
  });

  it("collapses a PLUS program to one schedule with no allocation finding", () => {
    const r = runEvaluate(
      "1/3 VEST OVER 12 months EVERY 1 month PLUS 1/3 VEST OVER 12 months EVERY 1 month PLUS 1/3 VEST OVER 12 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.resolution.status).toBe("template");
      expect(r.view.findings).toEqual([]);
      // 33 + 33 + 34 across the three thirds — the whole grant, allocated once.
      expect(sumInstallments(r.view.installments)).toBe(100);
      expect(r.breakdown).toHaveLength(3);
    }
  });

  it("reports a single over-allocation finding over the whole program", () => {
    const r = runEvaluate(
      "750 VEST OVER 12 months EVERY 1 month PLUS 750 VEST OVER 12 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 1000 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.valid).toBe(false);
      expect(r.view.findings).toHaveLength(1);
      expect(r.view.findings[0].kind).toBe("over-allocation");
      expect(r.view.findings[0].severity).toBe("error");
    }
  });

  it("surfaces an engine throw (the installment cap) as an evaluation error", () => {
    const r = runEvaluate("VEST OVER 1000000 months EVERY 1 month", grant);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.ruleId).toBe("evaluation-error");
  });

  it("short-circuits on a syntax error", () => {
    const r = runEvaluate("not vestlang", grant);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.ruleId).toBe("syntax-error");
  });
});

describe("runAsOf", () => {
  const eventGated = "VEST FROM EVENT ipo OVER 12 months EVERY 1 month";

  it("resolves an event-gated schedule once the event is supplied", () => {
    const r = runAsOf(
      eventGated,
      { ...grant, events: { ipo: "2020-01-01" } },
      "2030-01-01",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const summary: Summary = r.summary;
      expect(summary.total_vested).toBe(1200);
      expect(r.unresolved).toBe(0);
    }
  });

  it("leaves it unresolved when the event is missing", () => {
    const r = runAsOf(eventGated, grant, "2030-01-01");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.vested).toHaveLength(0);
      expect(r.unresolved).toBeGreaterThan(0);
    }
  });
});

describe("runVestedBetween", () => {
  it("rejects an inverted window", () => {
    const r = runVestedBetween(
      "VEST OVER 12 months EVERY 1 month",
      grant,
      "2025-12-31",
      "2025-01-01",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.ruleId).toBe("evaluation-error");
  });

  it("returns the resolved tranches inside the window", () => {
    const r = runVestedBetween(
      "VEST OVER 12 months EVERY 1 month",
      grant,
      "2025-01-01",
      "2025-12-31",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tranches_in_window).toBeGreaterThan(0);
      expect(r.vested_in_window).toBe(r.tranches_in_window * 100);
    }
  });
});
