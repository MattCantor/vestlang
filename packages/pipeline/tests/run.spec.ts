import { describe, it, expect } from "vitest";
import {
  runEvaluate,
  runAsOf,
  runVestedBetween,
  type GrantInput,
  type ScheduleView,
  type Summary,
} from "../src/index";

const grant: GrantInput = {
  grant_date: "2025-01-01",
  grant_quantity: 1200,
};

describe("runEvaluate", () => {
  it("classifies a plain date-anchored schedule as a template", () => {
    const r = runEvaluate("VEST OVER 12 months EVERY 1 month", grant);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const views: ScheduleView[] = r.views;
      expect(views).toHaveLength(1);
      expect(views[0].status).toBe("template");
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
      const summary: Summary = r.statements[0].summary;
      expect(summary.total_vested).toBe(1200);
      expect(r.statements[0].unresolved).toBe(0);
    }
  });

  it("leaves it unresolved when the event is missing", () => {
    const r = runAsOf(eventGated, grant, "2030-01-01");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.statements[0].vested).toHaveLength(0);
      expect(r.statements[0].unresolved).toBeGreaterThan(0);
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
      const stmt = r.statements[0];
      expect(stmt.tranches_in_window).toBeGreaterThan(0);
      expect(stmt.vested_in_window).toBe(stmt.tranches_in_window * 100);
    }
  });
});
