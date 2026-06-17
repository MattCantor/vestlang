import { describe, it, expect } from "vitest";
import { DEFAULT_VESTING_DAY_OF_MONTH } from "@vestlang/types";
import { runResolveOffset } from "../src/resolve-offset.js";

// runResolveOffset owns the `VEST FROM <expr>` resolution that the MCP
// resolve_offset tool calls. It reads the zero-length schedule's structural
// installment date, which is the same whenever you ask, so the sole installment
// resolves to a concrete date with no observation time involved — even for dates
// far past today. These cases moved from apps/mcp-server's date-math.test.ts and
// re-point at the pipeline entry, plus the after-today and day-of-month additions.

describe("runResolveOffset", () => {
  it("resolves a simple DATE + months expression", () => {
    const r = runResolveOffset({
      expr: "DATE 2025-01-01 + 6 months",
      grant_date: "2025-01-01",
    });
    expect(r).toEqual({ ok: true, date: "2025-07-01" });
  });

  it("resolves an EVENT + months expression with events map", () => {
    const r = runResolveOffset({
      expr: "EVENT ipo + 6 months",
      grant_date: "2025-01-01",
      events: { ipo: "2027-06-01" },
    });
    expect(r).toEqual({ ok: true, date: "2027-12-01" });
  });

  it("resolves a DATE - days expression", () => {
    const r = runResolveOffset({
      expr: "DATE 2025-01-10 - 2 days",
      grant_date: "2025-01-01",
    });
    expect(r).toEqual({ ok: true, date: "2025-01-08" });
  });

  it("returns the unresolved reason when the event is missing from events map", () => {
    const r = runResolveOffset({
      expr: "EVENT ipo + 6 months",
      grant_date: "2025-01-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.ruleId === "offset-unresolved") {
      expect(r.error.message).toMatch(/unresolved/i);
      // The hold-up names the missing event via blockerToString — "EVENT ipo".
      expect(r.error.unresolved).toMatch(/ipo/i);
    } else {
      expect.fail("expected an offset-unresolved refusal");
    }
  });

  it("resolves a pure offset (+N months) relative to grant_date", () => {
    const r = runResolveOffset({
      expr: "+3 months",
      grant_date: "2025-01-01",
    });
    expect(r).toEqual({ ok: true, date: "2025-04-01" });
  });

  it("surfaces parse errors", () => {
    const r = runResolveOffset({
      expr: "this is not vestlang",
      grant_date: "2025-01-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.ruleId).toBe("syntax-error");
      expect(r.error.message).toMatch(/parse/i);
      // Rewrapped against the synthetic `VEST FROM` prefix, so no source span.
      expect(r.error).not.toHaveProperty("loc");
    }
  });

  // A day offset large enough to overflow used to leak an internal runtime
  // validation message (the overflowed date got fed to the runtime constructor).
  // With the range guard running before formatting, it surfaces as the same
  // clean out-of-range error the date arithmetic raises everywhere else.
  it("raises a clean range error on an overflowing day offset", () => {
    expect(() =>
      runResolveOffset({ expr: "+ 100000000 days", grant_date: "2025-01-01" }),
    ).toThrow(/range/);
  });

  // A date that resolves well PAST today. Resolution reads the schedule's
  // structural installment date, not the wall clock, so a far-future start is just
  // a known date — it never reads "not yet." Pinned far enough out that no
  // plausible wall-clock run date is even relevant.
  it("resolves a far-future expression (after today) — date resolution ignores the clock", () => {
    const r = runResolveOffset({
      expr: "DATE 2099-01-01 + 6 months",
      grant_date: "2025-01-01",
    });
    expect(r).toEqual({ ok: true, date: "2099-07-01" });
  });

  // AC#6 — day-of-month pass-through. An explicit rule "15" lands the +1-month
  // offset on the 15th, NOT the month-end the input day would otherwise keep.
  it("applies an explicit vesting_day_of_month rule to the resolved date", () => {
    const r = runResolveOffset({
      expr: "DATE 2025-01-31 + 1 month",
      grant_date: "2025-01-01",
      vesting_day_of_month: "15",
    });
    expect(r).toEqual({ ok: true, date: "2025-02-15" });
  });

  // AC#6 — with no rule supplied, the pass-through default must match
  // DEFAULT_VESTING_DAY_OF_MONTH (the evaluator coalesces the same constant). Under
  // the default rule a +1-month offset off a month-end clamps to the month-end.
  it("with no rule, matches the evaluator's DEFAULT_VESTING_DAY_OF_MONTH", () => {
    const unset = runResolveOffset({
      expr: "DATE 2025-01-31 + 1 month",
      grant_date: "2025-01-01",
    });
    const explicit = runResolveOffset({
      expr: "DATE 2025-01-31 + 1 month",
      grant_date: "2025-01-01",
      vesting_day_of_month: DEFAULT_VESTING_DAY_OF_MONTH,
    });
    expect(unset).toEqual(explicit);
    expect(unset).toEqual({ ok: true, date: "2025-02-28" });
  });

  // AC#1 — a flat DATE before grant_date resolves to itself, not up to grant_date.
  // The old installment path folded any pre-grant amount onto grant_date and
  // returned "2025-06-01" here; the direct anchor resolution doesn't.
  it("resolves a pre-grant flat DATE to itself (no grant-date fold)", () => {
    const r = runResolveOffset({
      expr: "DATE 2024-01-01",
      grant_date: "2025-06-01",
    });
    expect(r).toEqual({ ok: true, date: "2024-01-01" });
  });

  // AC#2 — an event offset that lands before grant_date resolves to the true date.
  it("resolves a pre-grant EVENT offset to the true date", () => {
    const r = runResolveOffset({
      expr: "EVENT ipo - 6 months",
      grant_date: "2025-06-01",
      events: { ipo: "2025-09-30" },
    });
    expect(r).toEqual({ ok: true, date: "2025-03-30" });
  });

  // AC#3 — a small negative offset just before grant resolves strictly below it,
  // asserted as the anti-fold invariant directly.
  it("resolves a date just before grant strictly below grant_date", () => {
    const r = runResolveOffset({
      expr: "DATE 2025-06-01 - 2 days",
      grant_date: "2025-06-01",
    });
    expect(r).toEqual({ ok: true, date: "2025-05-30" });
    expect(r.ok && r.date < "2025-06-01").toBe(true);
  });

  // AC#5 — an unresolved selector names both unfired events through the same
  // blockerToString rendering ("EARLIER OF ( EVENT a, EVENT b )").
  it("names both events of an unresolved EARLIER OF selector", () => {
    const r = runResolveOffset({
      expr: "EARLIER OF ( EVENT a, EVENT b )",
      grant_date: "2025-01-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.ruleId === "offset-unresolved") {
      expect(r.error.unresolved).toMatch(/a/);
      expect(r.error.unresolved).toMatch(/b/);
    } else {
      expect.fail("expected an offset-unresolved refusal");
    }
  });

  // AC#6 — multi-statement input is refused, not truncated to the first head.
  // A PLUS fan-out parses to two independent heads; we used to drop the second and
  // return the first head's date, now we refuse.
  it("refuses a PLUS fan-out instead of returning the first head", () => {
    const r = runResolveOffset({
      expr: "EVENT a PLUS VEST FROM EVENT b",
      grant_date: "2025-01-01",
      events: { a: "2025-03-01", b: "2025-04-01" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.ruleId).toBe("offset-not-single-expression");
      expect(r.error.message).toMatch(
        /single|one statement|multiple statements|offset expression/i,
      );
    }
  });

  // AC#6 — a THEN tail parses to a head + chained tail. This is the intentional
  // behavior change: it used to return the head anchor's date, now it refuses.
  it("refuses a THEN tail instead of returning the head anchor's date", () => {
    const r = runResolveOffset({
      expr: "EVENT a THEN 200 VEST OVER 12 months EVERY 1 month",
      grant_date: "2025-01-01",
      events: { a: "2025-03-01" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.ruleId).toBe("offset-not-single-expression");
      expect(r.error.message).toMatch(
        /single|one statement|multiple statements|offset expression/i,
      );
    }
  });
});
