import { describe, it, expect } from "vitest";
import { evaluateVestingBase } from "../src/evaluate/vestingNode/vestingBase.js";
import {
  baseCtx,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeDuration,
} from "./helpers.js";
import { OCTDate } from "@vestlang/types";

describe("evaluateVestingBase", () => {
  it("DATE resolved when <= asOf", () => {
    const ctx = baseCtx({ asOf: "2024-02-01" as OCTDate });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2024-02-01" as OCTDate)),
      ctx,
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2024-02-01" as OCTDate });
  });

  it("DATE unresolved when > asOf, blocker is DATE_NOT_YET_OCCURRED", () => {
    const ctx = baseCtx({ asOf: "2024-01-01" as OCTDate });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2024-02-01" as OCTDate)),
      ctx,
    );
    expect(res.type).toBe("UNRESOLVED");
    expect((res as any).blockers[0].type).toBe("DATE_NOT_YET_OCCURRED");
  });

  it("EVENT resolved if ctx has date, with offsets applied (MONTHS)", () => {
    const ctx = baseCtx({
      events: {
        grantDate: "2025-01-01" as OCTDate,
        vestingStart: "2024-01-10" as OCTDate,
        boardApproval: "2024-01-31" as OCTDate,
      },
    });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseEvent("boardApproval"), [
        makeDuration(1, "MONTHS", "PLUS"),
      ]),
      ctx,
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2024-02-29" as OCTDate }); // 31_OR_LAST clamps
  });

  it("EVENT unresolved if missing", () => {
    const ctx = baseCtx({ events: { grantDate: "2025-01-01" as OCTDate } });
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseEvent("boardApproval")),
      ctx,
    );
    expect(res.type).toBe("UNRESOLVED");
    expect((res as any).blockers[0]).toMatchObject({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "boardApproval",
    });
  });

  it("DATE with offsets (DAYS MINUS)", () => {
    const ctx = baseCtx();
    const res = evaluateVestingBase(
      makeSingletonNode(makeVestingBaseDate("2024-03-10" as OCTDate), [
        makeDuration(10, "DAYS", "MINUS"),
      ]),
      ctx,
    );
    expect(res).toEqual({ type: "RESOLVED", date: "2024-02-29" as OCTDate });
  });

  it("DATE resolution ignores asOf when asOf=false", () => {
    const ctx = baseCtx({ asOf: "2024-01-01" as OCTDate });
    const node = makeSingletonNode(
      makeVestingBaseDate("2024-02-01" as OCTDate),
    );
    const res = evaluateVestingBase(node as any, ctx, false);
    expect(res).toEqual({ type: "RESOLVED", date: "2024-02-01" as OCTDate });
  });
});
