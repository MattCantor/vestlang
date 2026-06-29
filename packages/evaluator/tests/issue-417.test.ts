// Issue #417 — the runtime behavior the single key set has to preserve exactly.
// The structure refactor (iterate `RUNTIME_BASE_KEYS` instead of re-listing field
// names) must be byte-identical in what it produces: every present `RuntimeBase`
// field carried, every absent one omitted (not materialized as `key: undefined`),
// and the `VestingRuntime`-only `eventFirings` channel always dropped.
//
// Presence is asserted with `toHaveProperty` / `in` / `Object.keys`, never
// `toEqual`: Vitest treats `{ a: undefined }` as deep-equal to `{}`, so a
// deep-equality check would miss a stray materialized `undefined` — exactly the
// regression the "no `key: undefined`" guard cares about.

import { describe, it, expect } from "vitest";
import type {
  Amount,
  Program,
  ResolutionContextInput,
  Statement,
  VestingDayOfMonth,
  VestingNodeExpr,
  VestingPeriod,
  VestingRuntime,
} from "@vestlang/types";
import { DEFAULT_VESTING_DAY_OF_MONTH } from "@vestlang/types";
import { toStoredTerms, resolveInterchange } from "../src/resolve/interchange";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
} from "./helpers";

describe("#417 AC3 — toStoredTerms copies present RuntimeBase fields, omits absent ones, drops eventFirings", () => {
  it("a runtime with all RuntimeBase fields: each is copied", () => {
    const runtime: VestingRuntime = {
      startDate: "2025-01-01",
      grantDate: "2024-12-01",
      vestingDayOfMonth: "LAST_DAY_OF_MONTH",
    };
    const stored = toStoredTerms(runtime);
    expect(stored.startDate).toBe("2025-01-01");
    expect(stored.grantDate).toBe("2024-12-01");
    expect(stored.vestingDayOfMonth).toBe("LAST_DAY_OF_MONTH");
    expect(Object.keys(stored).sort()).toEqual([
      "grantDate",
      "startDate",
      "vestingDayOfMonth",
    ]);
  });

  it("a runtime with some fields: present copied, absent omitted (no materialized undefined)", () => {
    const runtime: VestingRuntime = { startDate: "2025-01-01" };
    const stored = toStoredTerms(runtime);

    expect(stored).toHaveProperty("startDate", "2025-01-01");
    // Absent fields must be genuinely absent — not present with value undefined.
    expect("grantDate" in stored).toBe(false);
    expect("vestingDayOfMonth" in stored).toBe(false);
    expect(Object.keys(stored)).toEqual(["startDate"]);
  });

  it("a runtime with no RuntimeBase fields: an empty StoredTerms", () => {
    const stored = toStoredTerms({});
    expect(Object.keys(stored)).toHaveLength(0);
  });

  it("a runtime carrying eventFirings yields a StoredTerms without it", () => {
    const runtime: VestingRuntime = {
      startDate: "2025-01-01",
      eventFirings: [{ event_id: "ipo", date: "2026-01-01" }],
    };
    const stored = toStoredTerms(runtime);
    expect(stored).toHaveProperty("startDate", "2025-01-01");
    // eventFirings lives only on VestingRuntime; the narrow always drops it.
    expect("eventFirings" in stored).toBe(false);
    expect(Object.keys(stored)).toEqual(["startDate"]);
  });
});

// AC4 — the date-shift field (`vestingDayOfMonth`) survives the projection. A
// dropped day-of-month would silently shift every projected installment date, so
// this guards the concrete risk #417 names: a non-default value rides through to
// the stored runtime; the default value is elided (the canonical default is
// re-applied on read, so storing it would be redundant).
describe("#417 AC4 — vestingDayOfMonth survives resolveInterchange when non-default", () => {
  const portion = (numerator: number, denominator: number): Amount => ({
    type: "PORTION",
    numerator,
    denominator,
  });

  const monthly12: VestingPeriod = {
    type: "MONTHS",
    length: 1,
    occurrences: 12,
  };

  const dateStmt = (start: VestingNodeExpr<"GRANT_DATE">): Statement => ({
    type: "STATEMENT",
    amount: portion(1, 1),
    expr: makeSingletonSchedule(start, monthly12),
  });

  const program: Program = [
    dateStmt(makeSingletonNode(makeVestingBaseDate("2025-01-01"))),
  ];

  const ctxInput = (
    vesting_day_of_month?: VestingDayOfMonth,
  ): ResolutionContextInput => ({
    grantDate: "2025-01-01",
    events: {},
    grantQuantity: 100000,
    ...(vesting_day_of_month !== undefined ? { vesting_day_of_month } : {}),
  });

  it("a non-default vestingDayOfMonth lands in the stored runtime", () => {
    const verdict = resolveInterchange(program, ctxInput("LAST_DAY_OF_MONTH"));
    expect(verdict.status).toBe("template");
    if (verdict.status !== "template") return;
    expect(verdict.runtime).toHaveProperty(
      "vestingDayOfMonth",
      "LAST_DAY_OF_MONTH",
    );
  });

  it("the default vestingDayOfMonth is omitted (re-applied on read)", () => {
    const verdict = resolveInterchange(
      program,
      ctxInput(DEFAULT_VESTING_DAY_OF_MONTH),
    );
    expect(verdict.status).toBe("template");
    if (verdict.status !== "template") return;
    expect("vestingDayOfMonth" in verdict.runtime).toBe(false);
  });
});
