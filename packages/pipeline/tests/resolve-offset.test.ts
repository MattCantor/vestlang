import { describe, it, expect } from "vitest";
import { DEFAULT_VESTING_DAY_OF_MONTH } from "@vestlang/types";
import { runResolveOffset } from "../src/resolve-offset.js";
import { runEvaluate } from "../src/run.js";

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

  // #253 — a displacement offset is exact: it does NOT consult the
  // vesting_day_of_month policy. So `DATE 2025-01-31 + 1 month` under rule "15"
  // keeps day 31 and clamps to Feb's last day (2025-02-28); it never snaps to the
  // 15th. (Pre-#253 this returned 2025-02-15.)
  it("steps an explicit-rule offset exactly, not onto the policy day", () => {
    const r = runResolveOffset({
      expr: "DATE 2025-01-31 + 1 month",
      grant_date: "2025-01-01",
      vesting_day_of_month: "15",
    });
    expect(r).toEqual({ ok: true, date: "2025-02-28" });
  });

  // #253 — and a non-clamping day is kept verbatim under the same rule: the 10th
  // stays the 10th, not the 15th.
  it("keeps a non-clamping offset day under an explicit rule (no snap)", () => {
    const r = runResolveOffset({
      expr: "DATE 2025-01-10 + 1 month",
      grant_date: "2025-01-01",
      vesting_day_of_month: "15",
    });
    expect(r).toEqual({ ok: true, date: "2025-02-10" });
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

  // #251 AC#11 — an EARLIER OF whose date arm is resolved and event arm is unfired
  // now COMMITS to the date floor (the latest the start could be), instead of
  // returning offset-unresolved. resolveVestingStart runs in resolution mode, so
  // the commit flows straight through this entry.
  //
  // #325 — and the commit no longer hides the assumption it leans on: the reply
  // discloses that the date floor assumes `ipo` stayed absent through it, as an
  // `absenceAssumptions` entry carrying the rendered message (the same wording the
  // full `evaluate` tool emits).
  it("EARLIER OF (DATE d, EVENT e), e unfired → resolves to d with the absence disclosure", () => {
    const r = runResolveOffset({
      expr: "EARLIER OF (DATE 2024-06-01, EVENT ipo)",
      grant_date: "2024-01-01",
      // ipo intentionally unfired.
    });
    expect(r).toEqual({
      ok: true,
      date: "2024-06-01",
      absenceAssumptions: [
        {
          eventId: "ipo",
          through: "2024-06-01",
          direction: "before",
          inclusive: false,
          message: "ipo did not occur before 2024-06-01",
        },
      ],
    });
  });

  // #325 — AC#5. An all-event EARLIER OF with nothing fired can't commit (no date
  // arm to fall to), so it stays offset-unresolved — and crucially carries no
  // absenceAssumptions: there's no commit, so there's no assumption to disclose.
  it("EARLIER OF (EVENT a, EVENT b), both unfired → offset-unresolved, no disclosure", () => {
    const r = runResolveOffset({
      expr: "EARLIER OF (EVENT a, EVENT b)",
      grant_date: "2025-01-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.ruleId).toBe("offset-unresolved");
    }
    // The failure arm has no success payload, so there's nowhere for a disclosure
    // to ride — assert it explicitly so a future regression can't sneak one on.
    expect(r).not.toHaveProperty("absenceAssumptions");
  });

  // #325 — AC#6. Cross-tool consistency: the bare { eventId, through } pairs that
  // resolve_offset surfaces for the committed EARLIER OF must match what the full
  // `evaluate` path reports for the SAME anchor (driven through a real schedule).
  // This asserts the two tools speak one disclosure vocabulary on the top-level
  // case; it is NOT a completeness guard for nested commits (#363) — a nested-commit
  // assertion would pass vacuously here, since both paths report an empty list there.
  it("the disclosure matches the full evaluate path on the same anchor", () => {
    const anchor = "EARLIER OF (DATE 2024-06-01, EVENT ipo)";

    const offset = runResolveOffset({
      expr: anchor,
      grant_date: "2024-01-01",
      // ipo intentionally unfired.
    });
    expect(offset.ok).toBe(true);

    const evaluated = runEvaluate(
      `VEST FROM ${anchor} OVER 12 months EVERY 1 month`,
      { grant_date: "2024-01-01", grant_quantity: 1200 },
    );
    expect(evaluated.ok).toBe(true);

    if (offset.ok && evaluated.ok) {
      // Strip the rendered message down to the structural pair on both sides, then
      // compare — the message wording is the same formatter, but the pairs are the
      // load-bearing claim.
      const offsetPairs = (offset.absenceAssumptions ?? []).map(
        ({ eventId, through }) => ({ eventId, through }),
      );
      const evaluatePairs = evaluated.view.absenceAssumptions.map(
        ({ eventId, through }) => ({ eventId, through }),
      );
      expect(offsetPairs).toEqual([{ eventId: "ipo", through: "2024-06-01" }]);
      expect(offsetPairs).toEqual(evaluatePairs);
    }
  });

  // #363 — a committed inner EARLIER OF consumed by an outer LATER OF used to drop
  // its disclosure on the way up. The narrow resolve_offset surface must carry it
  // too: the inner commits to 2024-09-01, the outer LATER OF folds it against
  // 2024-06-01 (so the date stays 2024-09-01), and `e` is disclosed `through` that
  // outer-fold date (Decision 2), rendered with the same message wording.
  it("LATER OF (EARLIER OF (DATE, EVENT e), DATE), e unfired → resolves with the nested-commit disclosure", () => {
    const r = runResolveOffset({
      expr: "LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-06-01)",
      grant_date: "2024-01-01",
      events: {},
    });
    expect(r).toEqual({
      ok: true,
      date: "2024-09-01",
      absenceAssumptions: [
        {
          eventId: "e",
          through: "2024-09-01",
          // Decision 3: the outer LATER OF re-stamps the inner EARLIER OF's blocker
          // but must NOT blunt its before/exclusive relation to the selector's
          // coarser after — the inner descriptor is preserved, only the boundary
          // widens to the outer-fold date.
          direction: "before",
          inclusive: false,
          message: "e did not occur before 2024-09-01",
        },
      ],
    });
  });
});
