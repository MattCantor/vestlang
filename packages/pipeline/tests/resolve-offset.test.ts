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
    if (!r.ok) {
      expect(r.error).toMatch(/unresolved/i);
      // The hold-up names the missing event (the installment's own reason, here
      // "EVENT ipo"; the blockerSummary fallback would word it as
      // "event(s) not provided: …").
      expect(r.unresolved).toMatch(/ipo/i);
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
    if (!r.ok) expect(r.error).toMatch(/parse/i);
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
});
