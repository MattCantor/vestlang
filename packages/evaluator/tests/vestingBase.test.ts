import { describe, it, expect } from "vitest";
import {
  evaluateVestingBase,
  type CliffEvaluationContext,
} from "../src/interpret/vestingNode/vestingBase.js";
import type { ResolvedNode } from "@vestlang/types";
import {
  baseCtx,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeVestingBaseVestingStart,
  makeDuration,
} from "./helpers.js";

describe("evaluateVestingBase", () => {
  it("DATE resolves to its literal value", () => {
    const ctx = baseCtx();
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2024-02-01")),
      ctx,
      "anchor",
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2024-02-01" });
  });

  it("DATE in the future still resolves — asOf doesn't gate a known date", () => {
    const ctx = baseCtx();
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2030-02-01")),
      ctx,
      "anchor",
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2030-02-01" });
  });

  it("EVENT resolved if ctx has date, with offsets applied (MONTHS)", () => {
    const ctx = baseCtx({
      grantDate: "2025-01-01",
      events: { vestingStart: "2024-01-10", boardApproval: "2024-01-31" },
    });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseEvent("boardApproval"), [
        makeDuration(1, "MONTHS", "PLUS"),
      ]),
      ctx,
      "anchor",
    );
    // An EVENT-anchored start steps exact (keep the day, clamp short months), so
    // Jan 31 + 1mo lands on Feb 29 (leap) by the keep-day clamp — NOT by the "31"
    // policy, which is no longer consulted for a displacement offset.
    expect(res).toEqual({ type: "RESOLVED", date: "2024-02-29" });
  });

  it("EVENT unresolved if missing", () => {
    const ctx = baseCtx({ grantDate: "2025-01-01", events: {} });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseEvent("boardApproval")),
      ctx,
      "anchor",
    );
    expect(res.type).toBe("UNRESOLVED");
    expect((res as { blockers: unknown[] }).blockers[0]).toMatchObject({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "boardApproval",
    });
  });

  it("DATE with offsets (DAYS MINUS)", () => {
    const ctx = baseCtx();
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2024-03-10"), [
        makeDuration(10, "DAYS", "MINUS"),
      ]),
      ctx,
      "anchor",
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2024-02-29" });
  });
});

// ---- Issue #253: a displacement MONTHS offset is exact — it never consults the
// day-of-month policy. Only cadence (the grid, and a cliff's own vestingStart
// anchor) snaps. These assert the rule at the offset-application surface, with a
// non-default policy (FIRST_DAY_OF_MONTH) that would visibly snap to the 1st if
// the bug were live. FIRST_DAY_OF_MONTH is the discriminating choice here: its
// snap day (the 1st) differs from every keep-day result below — including the
// day-31 clamp (Feb 28), where a month-end policy would coincide and prove nothing.

// The schedule's own anchor, resolved under FIRST_DAY_OF_MONTH.
const domFirst = (date: string): ResolvedNode => {
  const ctx = baseCtx({ vesting_day_of_month: "FIRST_DAY_OF_MONTH" });
  const res = evaluateVestingBase(
    makeSingletonNode(makeVestingBaseDate(date), [
      makeDuration(1, "MONTHS", "PLUS"),
    ]),
    ctx,
    "anchor",
  );
  return res as ResolvedNode;
};

describe("evaluateVestingBase — offset exactness under a fixed policy (#253)", () => {
  // AC1: a DATE start offset keeps its day under FIRST_DAY_OF_MONTH, not the 1st.
  it("DATE + 1 month keeps the day (2025-01-10 → 2025-02-10), not the policy day", () => {
    expect(domFirst("2025-01-10")).toEqual({
      type: "RESOLVED",
      date: "2025-02-10",
    });
  });

  // AC1 clamp arm: keep day 31, clamp to Feb's last day — never the 1st.
  it("DATE 2025-01-31 + 1 month clamps to 2025-02-28 (keep-day-31), not the 1st", () => {
    expect(domFirst("2025-01-31")).toEqual({
      type: "RESOLVED",
      date: "2025-02-28",
    });
  });

  // AC1: under the default policy the keep-day offset is unchanged.
  it("DATE + 1 month under the default policy is also 2025-02-10", () => {
    const ctx = baseCtx({
      vesting_day_of_month: "VESTING_START_DAY",
    });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2025-01-10"), [
        makeDuration(1, "MONTHS", "PLUS"),
      ]),
      ctx,
      "anchor",
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2025-02-10" });
  });

  // AC3: an EVENT-anchored start offset is exact on both arms.
  it("EVENT ipo + 6 months keeps the day (ipo 2025-01-20 → 2025-07-20)", () => {
    const ctx = baseCtx({
      vesting_day_of_month: "FIRST_DAY_OF_MONTH",
      events: { ipo: "2025-01-20" },
    });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseEvent("ipo"), [
        makeDuration(6, "MONTHS", "PLUS"),
      ]),
      ctx,
      "anchor",
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2025-07-20" });
  });

  it("EVENT ipo + 6 months clamps (ipo 2025-08-31 → 2026-02-28)", () => {
    const ctx = baseCtx({
      vesting_day_of_month: "FIRST_DAY_OF_MONTH",
      events: { ipo: "2025-08-31" },
    });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseEvent("ipo"), [
        makeDuration(6, "MONTHS", "PLUS"),
      ]),
      ctx,
      "anchor",
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2026-02-28" });
  });

  // AC3 default-policy arm: the same EVENT offsets are unchanged under the
  // canonical default — addMonthsExact never reads the policy, so keep-day and
  // clamp land identically to the FIRST_DAY_OF_MONTH runs above.
  it("EVENT ipo + 6 months under the default policy is unchanged (keep-day + clamp)", () => {
    const at = (ipo: string) => {
      const ctx = baseCtx({
        vesting_day_of_month: "VESTING_START_DAY",
        events: { ipo },
      });
      return evaluateVestingBase(
        makeSingletonNode(makeVestingBaseEvent("ipo"), [
          makeDuration(6, "MONTHS", "PLUS"),
        ]),
        ctx,
        "anchor",
      );
    };
    expect(at("2025-01-20")).toEqual({ type: "RESOLVED", date: "2025-07-20" });
    expect(at("2025-08-31")).toEqual({ type: "RESOLVED", date: "2026-02-28" });
  });

  // AC5 / Decision 2: a gate base steps exact regardless of its anchor — a DATE
  // gate reference + 1 month under FIRST_DAY_OF_MONTH resolves to the 10th, not the 1st.
  it("a DATE gate base + 1 month is exact (role 'gate'): 2025-02-10, not the 1st", () => {
    const ctx = baseCtx({ vesting_day_of_month: "FIRST_DAY_OF_MONTH" });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2025-01-10"), [
        makeDuration(1, "MONTHS", "PLUS"),
      ]),
      ctx,
      "gate",
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2025-02-10" });
  });

  // The cadence cliff: a node's OWN vestingStart anchor with a MONTHS offset
  // snaps to the policy day. This is the one case role 'anchor' snaps — proving
  // the discriminator isn't blanket-exact. Under FIRST_DAY_OF_MONTH the snap lands
  // on the 1st (2025-02-01), distinct from the exact keep-day 2025-02-10.
  it("a vestingStart cliff anchor + 1 month SNAPS to the policy day (the 1st)", () => {
    const ctx: CliffEvaluationContext = {
      ...baseCtx({ vesting_day_of_month: "FIRST_DAY_OF_MONTH" }),
      vestingStart: "2025-01-10",
    };
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseVestingStart(), [
        makeDuration(1, "MONTHS", "PLUS"),
      ]),
      ctx,
      "anchor",
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2025-02-01" });
  });

  // Same vestingStart anchor, but referenced as a GATE: exact, not snapped (the
  // #351 construct — `CLIFF … AFTER vesting_start + 1 month`, a vestingStart gate
  // only ever legal on a cliff). This is the trap the role discriminator exists to
  // avoid: keying on base.type alone would snap it.
  it("a vestingStart GATE base + 1 month is exact (the #351 case): 2025-02-10", () => {
    const ctx: CliffEvaluationContext = {
      ...baseCtx({ vesting_day_of_month: "FIRST_DAY_OF_MONTH" }),
      vestingStart: "2025-01-10",
    };
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseVestingStart(), [
        makeDuration(1, "MONTHS", "PLUS"),
      ]),
      ctx,
      "gate",
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2025-02-10" });
  });

  // AC2: spelling invariance — `+ 1 month` and `+ 30 days` differ only by the
  // calendar, neither jumps to the 1st.
  it("spelling invariance: +1 month (02-10) and +30 days (02-09) differ only by the calendar", () => {
    const monthRes = domFirst("2025-01-10");
    const ctx = baseCtx({ vesting_day_of_month: "FIRST_DAY_OF_MONTH" });
    const dayRes = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2025-01-10"), [
        makeDuration(30, "DAYS", "PLUS"),
      ]),
      ctx,
      "anchor",
    );
    expect(monthRes).toEqual({ type: "RESOLVED", date: "2025-02-10" });
    expect(dayRes).toEqual({ type: "RESOLVED", date: "2025-02-09" });
  });
});
