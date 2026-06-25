import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type { OCTDate, VestingNodeExpr } from "@vestlang/types";
import { lowerCliff, lowerDeferredCliff } from "../src/resolve/cliff";
import { resolveStatements } from "../src/resolve/lower";
import { createEvaluationContext } from "../src/utils";
import {
  baseCtx,
  makeGatedNode,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeDuration,
  makeVestingBaseGrantDate,
  makeVestingBaseVestingStart,
} from "./helpers";

const ctx = baseCtx({
  grantDate: "2025-01-01",
  events: { ipo: "2026-04-01" },
  vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
});
const anchor = "2025-01-01" as OCTDate;

describe("lowerCliff", () => {
  it("no cliff → NONE", () => {
    expect(lowerCliff(undefined, anchor, "MONTHS", 1, 48, ctx)).toEqual({
      state: "NONE",
    });
  });

  it("on-grid +12 month cliff → {length:12, period_type:MONTHS, percentage:1/4}", () => {
    const cliff: VestingNodeExpr<"VESTING_START"> = makeSingletonNode(
      makeVestingBaseVestingStart(),
      [makeDuration(12, "MONTHS", "PLUS")],
    );
    expect(lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx)).toEqual({
      state: "RESOLVED",
      cliff: {
        length: 12,
        period_type: "MONTHS",
        percentage: "0.25",
      },
      // #386 — the anchored path retains the absolute cliff date for the precision
      // guard's leading test: 2025-01-01 + 12 months.
      cliffDate: "2026-01-01",
    });
  });

  it("off-grid date cliff → falls back to DAYS, proportional pre-cliff share", () => {
    // 2025-03-17 on a monthly-4 grid: Feb 1 + Mar 1 are pre-cliff (m=2 of 4).
    const cliff: VestingNodeExpr<"VESTING_START"> = makeSingletonNode(
      makeVestingBaseDate("2025-03-17"),
    );
    expect(lowerCliff(cliff, anchor, "MONTHS", 1, 4, ctx)).toEqual({
      state: "RESOLVED",
      cliff: {
        length: 75, // 2025-01-01 + 75 days = 2025-03-17
        period_type: "DAYS",
        percentage: "0.5",
      },
      // #386 — the retained absolute cliff date (the resolved cliff date itself).
      cliffDate: "2025-03-17",
    });
  });

  // AC 2: a bare event cliff lowers to an event hold with no time cliff. The
  // firing rides on the record in resolution mode (here ipo is fired @ 2026-04-01).
  it("bare event cliff → EVENT_HELD, bare event side, no time cliff, firing recorded", () => {
    const cliff: VestingNodeExpr<"VESTING_START"> = makeSingletonNode(
      makeVestingBaseEvent("ipo"),
    );
    expect(lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx)).toEqual({
      state: "EVENT_HELD",
      event: { kind: "bare", eventId: "ipo" },
      firing: "2026-04-01",
    });
  });

  // A richer single event (an offset) collapses to a synthetic recipe — a bare id
  // can't hold the offset.
  it("event cliff with an offset → EVENT_HELD, synthetic event side", () => {
    const cliff: VestingNodeExpr<"VESTING_START"> = makeSingletonNode(
      makeVestingBaseEvent("ipo"),
      [makeDuration(1, "MONTHS", "PLUS")],
    );
    const result = lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx);
    expect(result.state).toBe("EVENT_HELD");
    if (result.state === "EVENT_HELD") {
      expect(result.event.kind).toBe("synthetic");
      // The firing is the event shifted by the offset (#149): 2026-04-01 + 1mo.
      expect(result.firing).toBe("2026-05-01");
    }
  });

  it("unfired event cliff → EVENT_HELD, no firing (held), real-event blocker", () => {
    const noIpo = baseCtx({ grantDate: "2025-01-01", events: {} });
    const cliff: VestingNodeExpr<"VESTING_START"> = makeSingletonNode(
      makeVestingBaseEvent("ipo"),
    );
    // Unfired → the hold carries the real event's pending blocker (`ipo`), so the
    // grid discloses on the named event rather than vanishing.
    expect(lowerCliff(cliff, anchor, "MONTHS", 1, 48, noIpo)).toEqual({
      state: "EVENT_HELD",
      event: { kind: "bare", eventId: "ipo" },
      blockers: [{ type: "EVENT_NOT_YET_OCCURRED", event: "ipo" }],
    });
  });

  it("cliff at/before the start → NONE", () => {
    const cliff: VestingNodeExpr<"VESTING_START"> = makeSingletonNode(
      makeVestingBaseDate("2024-06-01"),
    );
    expect(lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx)).toEqual({
      state: "NONE",
    });
  });

  // AC 4: LATER OF over two events → one synthetic recipe, fired firing = max(a,b).
  it("LATER OF(EVENT a, EVENT b) → EVENT_HELD, synthetic, firing = max(a,b)", () => {
    const c = baseCtx({
      grantDate: "2025-01-01",
      events: { a: "2026-03-01", b: "2026-07-01" },
    });
    const cliff: VestingNodeExpr<"VESTING_START"> = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseEvent("a")),
        makeSingletonNode(makeVestingBaseEvent("b")),
      ],
    };
    const result = lowerCliff(cliff, anchor, "MONTHS", 1, 48, c);
    expect(result.state).toBe("EVENT_HELD");
    if (result.state === "EVENT_HELD") {
      expect(result.event.kind).toBe("synthetic");
      expect(result.cliff).toBeUndefined();
      expect(result.firing).toBe("2026-07-01"); // max(a, b)
    }
  });

  it("LATER OF over two events, one unfired → EVENT_HELD, no firing (held)", () => {
    const c = baseCtx({
      grantDate: "2025-01-01",
      events: { a: "2026-03-01" },
    });
    const cliff: VestingNodeExpr<"VESTING_START"> = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseEvent("a")),
        makeSingletonNode(makeVestingBaseEvent("b")),
      ],
    };
    const result = lowerCliff(cliff, anchor, "MONTHS", 1, 48, c);
    expect(result.state).toBe("EVENT_HELD");
    if (result.state === "EVENT_HELD") expect(result.firing).toBeUndefined();
  });

  // AC 3: LATER OF(time, event) → a time cliff baseline PLUS the event hold.
  it("LATER OF(+12 months, EVENT ipo) → EVENT_HELD with a 12-month time cliff + bare event", () => {
    const cliff: VestingNodeExpr<"VESTING_START"> = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseVestingStart(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    };
    // anchor 2025-01-01, 1mo/48 grid: +12mo cliff is 12/48 = 1/4.
    expect(lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx)).toEqual({
      state: "EVENT_HELD",
      cliff: {
        length: 12,
        period_type: "MONTHS",
        percentage: "0.25",
      },
      cliffDate: "2026-01-01",
      event: { kind: "bare", eventId: "ipo" },
      firing: "2026-04-01",
    });
  });

  it("LATER OF(+12 months, EVENT ipo) with ipo unfired → EVENT_HELD, time cliff present, held", () => {
    const noIpo = baseCtx({ grantDate: "2025-01-01", events: {} });
    const cliff: VestingNodeExpr<"VESTING_START"> = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseVestingStart(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    };
    const result = lowerCliff(cliff, anchor, "MONTHS", 1, 48, noIpo);
    expect(result.state).toBe("EVENT_HELD");
    if (result.state === "EVENT_HELD") {
      expect(result.cliff).toEqual({
        length: 12,
        period_type: "MONTHS",
        percentage: "0.25",
      });
      expect(result.firing).toBeUndefined(); // held — the whole grid, including the lump
    }
  });

  // AC 9: an EARLIER OF cliff never grows an event_condition — it keeps the
  // existing behaviour (acceleration, no Carta home). Here both arms are known, so
  // the EARLIER OF commits to its floor as a plain time cliff.
  it("EARLIER OF(+12 months, EVENT ipo) → no EVENT_HELD (stays a plain time cliff)", () => {
    const cliff: VestingNodeExpr<"VESTING_START"> = {
      type: "NODE_EARLIER_OF",
      items: [
        makeSingletonNode(makeVestingBaseVestingStart(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    };
    const result = lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx);
    expect(result.state).not.toBe("EVENT_HELD");
  });
});

describe("lowerCliff — gated event cliff (#113)", () => {
  // CLIFF EVENT acquisition AFTER grantDate + 1 year: the gate decides whether
  // the event cliff stands, instead of being dropped. anchor is the grant date.
  const gatedCliff = makeGatedNode(
    makeVestingBaseEvent("acquisition"),
    "AFTER",
    makeSingletonNode(makeVestingBaseGrantDate(), [
      makeDuration(12, "MONTHS", "PLUS"),
    ]),
  );

  it("gate violated (event fired before the gate) → IMPOSSIBLE with IMPOSSIBLE_CONDITION", () => {
    // acquisition 2025-06-01 is not after grantDate + 12 months (2026-01-01). A
    // violated gate kills the cliff outright, so it lowers to IMPOSSIBLE.
    const c = baseCtx({
      grantDate: "2025-01-01",
      events: { acquisition: "2025-06-01" },
    });
    const result = lowerCliff(gatedCliff, anchor, "MONTHS", 1, 48, c);
    expect(result.state).toBe("IMPOSSIBLE");
    if (result.state === "IMPOSSIBLE") {
      expect(
        result.blockers.some((b) => b.type === "IMPOSSIBLE_CONDITION"),
      ).toBe(true);
    }
  });

  // AC 10: a gated event cliff → a SYNTHETIC event hold (the gate is captured in
  // the recipe). Gate satisfied + fired → the firing is the gated date.
  it("gate satisfied (event fired after the gate) → EVENT_HELD, synthetic, firing = gated date", () => {
    const c = baseCtx({
      grantDate: "2025-01-01",
      events: { acquisition: "2026-06-01" },
    });
    const result = lowerCliff(gatedCliff, anchor, "MONTHS", 1, 48, c);
    expect(result.state).toBe("EVENT_HELD");
    if (result.state === "EVENT_HELD") {
      expect(result.event.kind).toBe("synthetic");
      expect(result.firing).toBe("2026-06-01");
    }
  });

  it("gate pending (event unfired) → EVENT_HELD, synthetic, held (no firing)", () => {
    const c = baseCtx({ grantDate: "2025-01-01", events: {} });
    const result = lowerCliff(gatedCliff, anchor, "MONTHS", 1, 48, c);
    expect(result.state).toBe("EVENT_HELD");
    if (result.state === "EVENT_HELD") {
      expect(result.event.kind).toBe("synthetic");
      expect(result.firing).toBeUndefined();
    }
  });
});

describe("lowerDeferredCliff (no concrete anchor)", () => {
  const vsCliff = (value: number, unit: "DAYS" | "MONTHS") =>
    makeSingletonNode(makeVestingBaseVestingStart(), [
      makeDuration(value, unit, "PLUS"),
    ]);

  it("no cliff → NONE", () => {
    expect(lowerDeferredCliff(undefined, "MONTHS", 1, 48, ctx)).toEqual({
      state: "NONE",
    });
  });

  it("vestingStart + 12 months on a 1-month/48 grid → {12mo, 1/4}, anchor-free", () => {
    expect(
      lowerDeferredCliff(vsCliff(12, "MONTHS"), "MONTHS", 1, 48, ctx),
    ).toEqual({
      state: "RESOLVED",
      cliff: {
        length: 12,
        period_type: "MONTHS",
        percentage: "0.25",
      },
    });
  });

  it("off-grid duration cliff (7mo on a 2-month grid) → m = floor(7/2) = 3", () => {
    expect(
      lowerDeferredCliff(vsCliff(7, "MONTHS"), "MONTHS", 2, 24, ctx),
    ).toEqual({
      state: "RESOLVED",
      cliff: {
        length: 7,
        period_type: "MONTHS",
        percentage: "0.125", // 3/24
      },
    });
  });

  it("day-unit cliff on a day-unit grid is anchor-free", () => {
    expect(
      lowerDeferredCliff(vsCliff(90, "DAYS"), "DAYS", 30, 12, ctx),
    ).toEqual({
      state: "RESOLVED",
      cliff: {
        length: 90,
        period_type: "DAYS",
        percentage: "0.25", // 3/12
      },
    });
  });

  it("cliff shorter than the first occurrence → NONE (no pre-cliff share)", () => {
    expect(
      lowerDeferredCliff(vsCliff(11, "MONTHS"), "MONTHS", 12, 4, ctx),
    ).toEqual({
      state: "NONE",
    });
  });

  it("cross-unit cliff (months over a days grid) needs the anchor → UNRESOLVED", () => {
    expect(
      lowerDeferredCliff(vsCliff(12, "MONTHS"), "DAYS", 30, 48, ctx),
    ).toEqual({
      state: "UNRESOLVED",
      blockers: [],
      shape: { kind: "symbolic" },
    });
  });

  // On the deferred (contingent-start) path the cliff still decomposes — a bare
  // event cliff is an event hold with no time baseline (Decision 7 / AC 11).
  it("bare event cliff on a deferred start → EVENT_HELD, bare, held", () => {
    const cliff = makeSingletonNode(makeVestingBaseEvent("ipo"));
    expect(lowerDeferredCliff(cliff, "MONTHS", 1, 48, ctx)).toEqual({
      state: "EVENT_HELD",
      event: { kind: "bare", eventId: "ipo" },
    });
  });

  // LATER OF(time, event) on a deferred start: the relative time baseline is still
  // derivable anchor-free; the event side becomes the hold.
  it("LATER OF(+12 months, EVENT ipo) on a deferred start → EVENT_HELD with the time cliff + bare event", () => {
    const cliff: VestingNodeExpr<"VESTING_START"> = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseVestingStart(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    };
    expect(lowerDeferredCliff(cliff, "MONTHS", 1, 48, ctx)).toEqual({
      state: "EVENT_HELD",
      cliff: {
        length: 12,
        period_type: "MONTHS",
        percentage: "0.25",
      },
      event: { kind: "bare", eventId: "ipo" },
    });
  });

  // A gated event cliff on a deferred start → a synthetic event hold (the gate is
  // captured in the recipe), with no derivable time baseline.
  it("gated event cliff on a deferred start → EVENT_HELD, synthetic", () => {
    const cliff = makeGatedNode(
      makeVestingBaseEvent("acquisition"),
      "AFTER",
      makeSingletonNode(makeVestingBaseGrantDate(), [
        makeDuration(6, "MONTHS", "PLUS"),
      ]),
    );
    const result = lowerDeferredCliff(cliff, "MONTHS", 1, 48, ctx);
    expect(result.state).toBe("EVENT_HELD");
    if (result.state === "EVENT_HELD") {
      expect(result.event.kind).toBe("synthetic");
      expect(result.cliff).toBeUndefined();
    }
  });

  // A cliff measured from grant date can't reach this function any more: the
  // cliff slot is typed VestingNodeExpr<"VESTING_START">, so a GRANT_DATE base is
  // rejected at compile time (and the parser rejects it at any selector depth —
  // #110). The "needs the anchor → UNRESOLVED" path is still covered by the
  // DATE-cliff and event-cliff cases above, whose base is likewise not VESTING_START.
});

// #412 — a held cliff on a chain segment decides the handoff to the next tail. The
// segment's bare grid end is no longer the handoff: an unfired hold ends nothing
// (the tail pends), and a fired hold folds the grid at the firing so the tail
// re-anchors after it. These pin the per-statement records `resolveStatements`
// produces — what `anchorAfter` writes onto the following tail.
describe("resolveStatements — a held head's cliff folds the chain handoff (#412)", () => {
  const D =
    "0.5 VEST OVER 4 months EVERY 1 month CLIFF EVENT ipo THEN 0.5 VEST OVER 4 months EVERY 1 month";
  const resolve = (events: Record<string, OCTDate>) => {
    const program = normalizeProgram(parse(D));
    const ctxInput = {
      grantDate: "2024-01-01" as OCTDate,
      grantQuantity: 800,
      events,
    };
    return resolveStatements(
      program,
      createEvaluationContext(ctxInput, "resolution"),
    );
  };

  it("UNFIRED head → the tail is a pending-tail carrying the head's event blocker", () => {
    const [headRes, tailRes] = resolve({});
    // The head is dated with an unfired event hold.
    expect(headRes.start.state).toBe("RESOLVED");
    expect(headRes.cliff.state).toBe("EVENT_HELD");
    if (headRes.cliff.state === "EVENT_HELD")
      expect(headRes.cliff.firing).toBeUndefined();
    // The handoff is held: the tail can't date, so it's a pending-tail with an
    // UNRESOLVED start that names what it waits on.
    expect(tailRes.chain.role).toBe("pending-tail");
    expect(tailRes.start.state).toBe("UNRESOLVED");
    if (tailRes.start.state === "UNRESOLVED")
      expect(tailRes.start.blockers).toContainEqual({
        type: "EVENT_NOT_YET_OCCURRED",
        event: "ipo",
      });
  });

  it("LATE firing → the tail re-anchors at the fold point (2025-12-01), not the bare grid end", () => {
    const [, tailRes] = resolve({ ipo: "2025-12-01" });
    // The handoff folded at the firing: the tail is a dated tail whose start is the
    // fold point, NOT the head's bare grid end (2024-05-01). Its first tranche then
    // grids one month later (2026-01-01).
    expect(tailRes.chain.role).toBe("tail");
    expect(tailRes.start.state).toBe("RESOLVED");
    if (tailRes.start.state === "RESOLVED")
      expect(tailRes.start.date).toBe("2025-12-01");
  });

  it("EARLY firing under a long head → the tail keeps the bare grid end (no fold-point pull-back)", () => {
    const longHead =
      "0.5 VEST OVER 24 months EVERY 1 month CLIFF EVENT ipo THEN 0.5 VEST OVER 4 months EVERY 1 month";
    const program = normalizeProgram(parse(longHead));
    const [, tailRes] = resolveStatements(
      program,
      createEvaluationContext(
        {
          grantDate: "2024-01-01",
          grantQuantity: 800,
          events: { ipo: "2024-06-01" },
        },
        "resolution",
      ),
    );
    // The bare grid end (2026-01-01) is later than the fold point (2024-06-01), so
    // it wins the max and the tail's start stays the bare end.
    expect(tailRes.chain.role).toBe("tail");
    expect(tailRes.start.state).toBe("RESOLVED");
    if (tailRes.start.state === "RESOLVED")
      expect(tailRes.start.date).toBe("2026-01-01");
  });
});
