import { describe, it, expect } from "vitest";
import { evaluateVestingBase } from "../src/evaluate/vestingNode/vestingBase.js";
import {
  baseCtx,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeDuration,
} from "./helpers.js";

describe("evaluateVestingBase", () => {
  it("DATE resolves to its literal value", () => {
    const ctx = baseCtx();
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2024-02-01")),
      ctx,
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2024-02-01" });
  });

  it("DATE in the future still resolves — asOf doesn't gate a known date", () => {
    const ctx = baseCtx();
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2030-02-01")),
      ctx,
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
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2024-02-29" }); // 31_OR_LAST clamps
  });

  it("EVENT unresolved if missing", () => {
    const ctx = baseCtx({ grantDate: "2025-01-01", events: {} });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseEvent("boardApproval")),
      ctx,
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
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2024-02-29" });
  });
});
