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
  it("DATE resolved when <= asOf", () => {
    const ctx = baseCtx({ asOf: "2024-02-01" });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2024-02-01")),
      ctx,
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2024-02-01" });
  });

  it("DATE unresolved when > asOf, blocker is DATE_NOT_YET_OCCURRED", () => {
    const ctx = baseCtx({ asOf: "2024-01-01" });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2024-02-01")),
      ctx,
    );
    expect(res.type).toBe("UNRESOLVED");
    expect((res as { blockers: { type: string }[] }).blockers[0].type).toBe(
      "DATE_NOT_YET_OCCURRED",
    );
  });

  it("EVENT resolved if ctx has date, with offsets applied (MONTHS)", () => {
    const ctx = baseCtx({
      events: {
        grantDate: "2025-01-01",
        vestingStart: "2024-01-10",
        boardApproval: "2024-01-31",
      },
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
    const ctx = baseCtx({ events: { grantDate: "2025-01-01" } });
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

  it("DATE resolution ignores asOf when asOf=false", () => {
    const ctx = baseCtx({ asOf: "2024-01-01" });
    const node = makeSingletonNode(makeVestingBaseDate("2024-02-01"));
    const res = evaluateVestingBase(node, ctx, false);
    expect(res).toEqual({ type: "RESOLVED", date: "2024-02-01" });
  });
});
