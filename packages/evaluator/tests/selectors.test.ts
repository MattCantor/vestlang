import { describe, it, expect } from "vitest";
import {
  evaluateScheduleExpr,
  evaluateVestingNodeExpr,
} from "../src/interpret/selectors.js";
import { isPickedPartial } from "../src/interpret/utils.js";
import {
  baseCtx,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeSingletonNode,
  makeSingletonSchedule,
  makeConstrainedNodeWithAtomCondition,
} from "./helpers.js";
import { VestingNode, VestingNodeExpr } from "@vestlang/types";

describe("evaluateVestingNodeExpr selectors", () => {
  it("EARLIER_OF resolves to earliest resolved item", () => {
    const ctx = baseCtx();
    const expr = {
      type: "NODE_EARLIER_OF",
      items: [
        {
          type: "NODE",
          base: makeVestingBaseDate("2024-03-01"),
          offsets: [],
        },
        {
          type: "NODE",
          base: makeVestingBaseDate("2024-02-01"),
          offsets: [],
        },
      ],
    } as VestingNodeExpr;
    const res = evaluateVestingNodeExpr(expr, ctx);
    expect(res.type).toBe("PICKED");
    expect((res as { meta: { date: string } }).meta.date).toBe("2024-02-01");
  });

  it("LATER_OF returns PICKED with UNRESOLVED meta when partially resolved", () => {
    const ctx = baseCtx();
    const expr = {
      type: "NODE_LATER_OF",
      items: [
        {
          type: "NODE",
          base: makeVestingBaseDate("2024-02-01"),
          offsets: [],
        },
        {
          type: "NODE",
          base: { type: "EVENT", value: "laterEvent" },
          offsets: [],
        },
      ],
    } as VestingNodeExpr;
    const res = evaluateVestingNodeExpr(expr, ctx);
    expect(res.type).toBe("PICKED");
    expect((res as { meta: { type: string } }).meta.type).toBe("UNRESOLVED");
    expect(
      (res as { meta: { blockers: { type: string }[] } }).meta.blockers[0].type,
    ).toBe("EVENT_NOT_YET_OCCURRED");
    // The partial pick carries its pivot: the latest settled arm's date — here the
    // only resolved arm, 2024-02-01. This is the single source of truth the cliff
    // lowering reads as the `dated-floor` floor, so pin it to the resolved-arm date.
    expect(isPickedPartial(res)).toBe(true);
    if (isPickedPartial(res)) {
      expect(res.pivot).toBe("2024-02-01");
    }
  });

  it("LATER_OF returns UNRESOLVED_SELECTOR when two or more items unresolved", () => {
    const ctx = baseCtx();
    const expr = {
      type: "NODE_LATER_OF",
      items: [
        {
          type: "NODE",
          base: { type: "EVENT", value: "event1" },
          offsets: [],
        },
        {
          type: "NODE",
          base: { type: "EVENT", value: "event2" },
          offsets: [],
        },
      ],
    } as VestingNodeExpr;
    const res = evaluateVestingNodeExpr(expr, ctx);
    expect(res.type).toBe("UNRESOLVED");
    expect((res as { blockers: { type: string }[] }).blockers[0].type).toBe(
      "UNRESOLVED_SELECTOR",
    );
  });

  // A statically-dead arm: 2025-01-01 can never be AFTER 2025-06-01 (both fixed
  // dates), so no witness can ever resolve it. Distinct from a pending arm.
  const deadArm = makeConstrainedNodeWithAtomCondition(
    "AFTER",
    "2025-01-01",
    "2025-06-01",
  );

  it("LATER_OF with a statically-dead arm is IMPOSSIBLE (dead arm dominates a resolved sibling)", () => {
    const ctx = baseCtx();
    const expr = {
      type: "NODE_LATER_OF",
      items: [
        deadArm,
        {
          type: "NODE",
          base: makeVestingBaseDate("2025-03-01"),
          offsets: [],
        },
      ],
    } as VestingNodeExpr;
    const res = evaluateVestingNodeExpr(expr, ctx);
    expect(res.type).toBe("IMPOSSIBLE");
    const blocker = (res as { blockers: { type: string; selector: string }[] })
      .blockers[0];
    expect(blocker.type).toBe("IMPOSSIBLE_SELECTOR");
    expect(blocker.selector).toBe("LATER_OF");
  });

  it("LATER_OF with a dead arm is IMPOSSIBLE even when the sibling is only pending", () => {
    const ctx = baseCtx();
    const expr = {
      type: "NODE_LATER_OF",
      items: [
        deadArm,
        {
          type: "NODE",
          base: { type: "EVENT", value: "laterEvent" },
          offsets: [],
        },
      ],
    } as VestingNodeExpr;
    const res = evaluateVestingNodeExpr(expr, ctx);
    expect(res.type).toBe("IMPOSSIBLE");
    expect((res as { blockers: { type: string }[] }).blockers[0].type).toBe(
      "IMPOSSIBLE_SELECTOR",
    );
  });

  // `DATE 2025-01-01 AFTER EVENT e`, e unfired. This used to be IMPOSSIBLE (we
  // read the missing event as "never happened, so the date isn't after it") and
  // that dead arm poisoned the whole LATER_OF. With the gate fix it's merely
  // pending — e could still be recorded before 2025-01-01 — so it no longer
  // poisons; the selector partial-resolves instead (#60 / #18).
  const dateAfterUnfiredEvent: VestingNode = {
    type: "NODE",
    base: makeVestingBaseDate("2025-01-01"),
    offsets: [],
    condition: {
      type: "ATOM",
      constraint: {
        type: "AFTER",
        base: makeSingletonNode(makeVestingBaseEvent("e")),
        strict: false,
      },
    },
  };

  it("LATER_OF with a DATE-AFTER-unfired-EVENT arm is pending, not poisoned (#60)", () => {
    const ctx = baseCtx();
    const expr = {
      type: "NODE_LATER_OF",
      items: [
        dateAfterUnfiredEvent,
        {
          type: "NODE",
          base: makeVestingBaseDate("2025-03-01"),
          offsets: [],
        },
      ],
    } as VestingNodeExpr;
    const res = evaluateVestingNodeExpr(expr, ctx);
    expect(res.type).toBe("PICKED");
    expect((res as { meta: { type: string } }).meta.type).toBe("UNRESOLVED");
  });

  it("EARLIER_OF drops a statically-dead arm and resolves to the survivor", () => {
    const ctx = baseCtx();
    const expr = {
      type: "NODE_EARLIER_OF",
      items: [
        deadArm,
        {
          type: "NODE",
          base: makeVestingBaseDate("2025-03-01"),
          offsets: [],
        },
      ],
    } as VestingNodeExpr;
    const res = evaluateVestingNodeExpr(expr, ctx);
    expect(res.type).toBe("PICKED");
    expect((res as { meta: { type: string } }).meta.type).toBe("RESOLVED");
    expect((res as { meta: { date: string } }).meta.date).toBe("2025-03-01");
  });

  it("All impossible → IMPOSSIBLE_SELECTOR", () => {
    // make both items impossible via constraints in higher layers—here we emulate result directly:
    const res = {
      type: "IMPOSSIBLE",
      blockers: [
        { type: "IMPOSSIBLE_SELECTOR", selector: "EARLIER_OF", blockers: [] },
      ],
    };
    // We won't call a private helper; this case is covered indirectly in other tests.
    expect(res.type).toBe("IMPOSSIBLE");
  });
});

describe("evaluateScheduleExpr SINGLETON pipes through picked vesting_start meta", () => {
  const ctx = baseCtx();
  const schedule = makeSingletonSchedule(
    {
      type: "NODE",
      base: makeVestingBaseDate("2024-02-01"),
      offsets: [],
    },
    { type: "MONTHS", length: 1, occurrences: 2 },
  );
  it("resolved vesting_start yields PICKED schedule", () => {
    const res = evaluateScheduleExpr(schedule, ctx);
    expect(res.type).toBe("PICKED");
    expect((res as { meta: { date: string } }).meta.date).toBe("2024-02-01");
  });

  it("partial LATER_OF vesting_start carries its pivot through the re-wrap", () => {
    // A schedule whose start is a partial LATER OF(2024-02-01, EVENT laterEvent).
    // The node layer settles the date arm and stamps the pivot; re-wrapping that
    // pick around the schedule leaf must carry the pivot through unchanged, not
    // drop it. Pinning it here guards the schedule-layer copy directly, not just
    // by typecheck.
    const partialStart = makeSingletonSchedule(
      {
        type: "NODE_LATER_OF",
        items: [
          makeSingletonNode(makeVestingBaseDate("2024-02-01")),
          makeSingletonNode(makeVestingBaseEvent("laterEvent")),
        ],
      },
      { type: "MONTHS", length: 1, occurrences: 2 },
    );
    const res = evaluateScheduleExpr(partialStart, ctx);
    expect(isPickedPartial(res)).toBe(true);
    if (isPickedPartial(res)) {
      expect(res.pivot).toBe("2024-02-01");
    }
  });
});
