// The consumer rule, made explicit. `presentSchedule` derives five orthogonal
// reads — representable (status), pending (the pending blocker list, NOT
// status === "unresolved"), dead (the dead blocker list), projected
// (installments), valid (findings). The load-bearing cases are a pending-template
// (status "template" AND pending blockers must read representable-but-pending, not
// complete) and a dead-arm-beside-a-live-one (status "unresolved" with only dead
// blockers must read dead, not pending).

import { describe, it, expect } from "vitest";
import type {
  Amount,
  EvaluatedSchedule,
  ResolutionContextInput,
  Finding,
  Installment,
  InterchangeVerdict,
  Program,
  ResolutionStatus,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { evaluateProgram } from "@vestlang/evaluator";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { presentSchedule } from "../src/present";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
} from "./helpers";

// presentSchedule reads the interchange status (representable), the resolution
// status/pending/dead/installments (pending, dead, projected), and findings
// (valid), so stub exactly those. The interchange status defaults to the
// firing-invariant counterpart of the resolution status — the same except that a
// closed-world "unresolved" has no interchange equivalent and reads as
// "unrepresentable" — but a test can pass its own to exercise the two verdicts
// diverging. Findings default to none (a well-formed schedule).
const interchangeFor = (
  status: ResolutionStatus,
): InterchangeVerdict["status"] =>
  status === "unresolved" ? "unrepresentable" : status;

const stub = (
  status: ResolutionStatus,
  blockers: { pending?: unknown[]; dead?: unknown[] },
  installments: Installment[],
  findings: Finding[] = [],
  interchangeStatus: InterchangeVerdict["status"] = interchangeFor(status),
): EvaluatedSchedule =>
  ({
    interchange: { status: interchangeStatus },
    resolution: {
      status,
      pending: blockers.pending ?? [],
      dead: blockers.dead ?? [],
      installments,
    },
    absenceAssumptions: [],
    findings,
  }) as unknown as EvaluatedSchedule;

const overAllocated: Finding[] = [
  {
    kind: "over-allocation",
    severity: "error",
    sum: { numerator: 3, denominator: 2 },
    path: ["Program"],
  },
];
const underAllocated: Finding[] = [
  {
    kind: "under-allocation",
    severity: "warning",
    sum: { numerator: 1, denominator: 2 },
    path: ["Program"],
  },
];

const dated: Installment[] = [
  { state: "RESOLVED", amount: 100, date: "2025-02-01" },
];
const symbolic: Installment[] = [
  {
    state: "UNRESOLVED",
    amount: 100,
    symbolicDate: { type: "UNRESOLVED_VESTING_START" },
  },
];
const eventBlocker = [{ type: "EVENT_NOT_YET_OCCURRED", event: "ipo" }];
// A contradiction — present.ts reads it as a resolution-space dead blocker. Carried
// as a plain shape; the stub coerces the whole schedule through `unknown`.
const impossibleBlocker = [
  { type: "IMPOSSIBLE_SELECTOR", selector: "EARLIER_OF", blockers: [] },
];

describe("presentSchedule — the orthogonal reads", () => {
  it("template + pending blockers (pending-template) → representable AND pending", () => {
    expect(
      presentSchedule(stub("template", { pending: eventBlocker }, dated)),
    ).toEqual({
      representable: true,
      pending: true,
      dead: false,
      projected: true,
      valid: true,
    });
  });

  it("template, no blockers, dated → representable, not pending, projected", () => {
    expect(presentSchedule(stub("template", {}, dated))).toEqual({
      representable: true,
      pending: false,
      dead: false,
      projected: true,
      valid: true,
    });
  });

  it("an error finding makes the schedule read invalid (separate from representable)", () => {
    const p = presentSchedule(stub("template", {}, dated, overAllocated));
    expect(p.valid).toBe(false);
    expect(p.representable).toBe(true); // the interchange still holds it
  });

  it("a warning finding (under-allocation) leaves the schedule valid", () => {
    const p = presentSchedule(stub("template", {}, dated, underAllocated));
    expect(p.valid).toBe(true); // only error-severity findings flip valid
  });

  it("annotate, don't certify: an over-allocating pending template stays projected", () => {
    // representable + pending + projected, but invalid — the legal partial
    // projection is still surfaced; it just isn't certified valid.
    const p = presentSchedule(
      stub("template", { pending: eventBlocker }, dated, overAllocated),
    );
    expect(p).toEqual({
      representable: true,
      pending: true,
      dead: false,
      projected: true,
      valid: false,
    });
  });

  it("events-only → representable, not pending", () => {
    const p = presentSchedule(stub("events-only", {}, dated));
    expect(p.representable).toBe(true);
    expect(p.pending).toBe(false);
  });

  it("unresolved → pending, not representable (pending read off the pending list, not status)", () => {
    const p = presentSchedule(
      stub("unresolved", { pending: eventBlocker }, symbolic),
    );
    expect(p.representable).toBe(false);
    expect(p.pending).toBe(true);
    expect(p.dead).toBe(false);
    expect(p.projected).toBe(false);
  });

  it("impossible (all dead) → neither representable nor pending; dead is true (terminal)", () => {
    const p = presentSchedule(
      stub("impossible", { dead: impossibleBlocker }, []),
    );
    expect(p.representable).toBe(false);
    expect(p.pending).toBe(false);
    expect(p.dead).toBe(true);
  });
});

// End-to-end through the real pipeline: a 4,800-share hybrid (dated portion +
// unfired-event portion).
describe("presentSchedule — end-to-end hybrid", () => {
  const portion = (numerator: number, denominator: number): Amount => ({
    type: "PORTION",
    numerator,
    denominator,
  });
  const stmt = (
    amount: Amount,
    start: VestingNodeExpr<"GRANT_DATE">,
    periodicity: VestingPeriod,
  ) => ({
    type: "STATEMENT" as const,
    amount,
    expr: makeSingletonSchedule(start, periodicity),
  });
  const ctxInput = (): ResolutionContextInput => ({
    grantDate: "2025-01-01",
    events: {},
    grantQuantity: 4800,
  });

  it("75% MONTHLY + 25% unfired EVENT → events-only (two origins) that is representable-but-pending", () => {
    // A fixed dated start beside a contingent event start is two start origins, so
    // it's events-only rather than one template — but events-only is still
    // representable, and the unfired event keeps it pending.
    const program: Program = [
      stmt(
        portion(3, 4),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 1,
          occurrences: 48,
        },
      ),
      stmt(portion(1, 4), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 0,
        occurrences: 1,
      }),
    ];
    const out = evaluateProgram(program, ctxInput()); // ipo unfired
    expect(out.resolution.status).toBe("events-only");
    expect(presentSchedule(out)).toEqual({
      representable: true,
      pending: true,
      dead: false,
      projected: true,
      valid: true,
    });
  });

  it("[resolving, void] → storable as a template, yet resolves to unresolved", () => {
    const voidStart: VestingNode<"GRANT_DATE"> = {
      type: "NODE",
      base: makeVestingBaseEvent("a"),
      offsets: [],
      condition: {
        type: "ATOM",
        constraint: {
          type: "BEFORE",
          base: makeSingletonNode(makeVestingBaseDate("2025-01-01")),
          strict: false,
        },
      },
    };
    const program: Program = [
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 12,
          occurrences: 2,
        },
      ),
      stmt(portion(1, 2), voidStart, {
        type: "MONTHS",
        length: 12,
        occurrences: 2,
      }),
    ];
    // a fires after the BEFORE deadline → void half; the DATE half resolves.
    const out = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: { a: "2025-06-01" },
      grantQuantity: 4800,
    });
    // The two verdicts come apart here, which is the whole point of splitting
    // them. Closed-world, with `a` fired late, the gated half is dead and the
    // program resolves to `unresolved`. Firing-blind, the gated event start is a
    // contingent origin beside the fixed dated grid — two distinct origins — so the
    // storable verdict is events-only (still representable). A different firing of
    // `a` would resolve it.
    expect(out.resolution.status).toBe("unresolved");
    expect(out.interchange.status).toBe("events-only");
    if (out.interchange.status === "events-only") {
      expect(out.interchange.reason.kind).toBe("MULTIPLE_START_ORIGINS");
    }
    // The void half carries an IMPOSSIBLE_CONDITION blocker — dead, not pending.
    // This is the present.ts fix (AC#3): a dead arm beside a live one reads
    // `dead: true`, `pending: false`, not the reverse.
    expect(presentSchedule(out)).toEqual({
      representable: true, // storable (events-only), independent of a's firing
      pending: false, // nothing is merely waiting — the void half is dead
      dead: true, // the void half's IMPOSSIBLE_CONDITION surfaces here
      projected: true, // the resolved half's dated tranches are now surfaced
      valid: true,
    });
  });

  it("two date grids + 25% unfired EVENT → events-only that is still pending", () => {
    // The dated portions force the events arm, but the event portion is still
    // waiting — the collapsed verdict must read pending off its blocker, not
    // pretend the schedule is settled because most of it dated.
    const monthly2: VestingPeriod = {
      type: "MONTHS",
      length: 1,
      occurrences: 2,
    };
    const program: Program = [
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        monthly2,
      ),
      stmt(
        portion(1, 4),
        makeSingletonNode(makeVestingBaseDate("2025-06-15")),
        monthly2,
      ),
      stmt(
        portion(1, 4),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
        monthly2,
      ),
    ];
    const out = evaluateProgram(program, ctxInput()); // ipo unfired
    expect(out.resolution.status).toBe("events-only");
    expect(presentSchedule(out)).toEqual({
      representable: true,
      pending: true, // the event portion's blocker survives the events arm
      dead: false,
      projected: true,
      valid: true,
    });
  });

  it("3/4 + 3/4 over one grant → projected but invalid (don't hide the projection)", () => {
    const program: Program = [
      stmt(
        portion(3, 4),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        { type: "MONTHS", length: 12, occurrences: 1 },
      ),
      stmt(
        portion(3, 4),
        makeSingletonNode(makeVestingBaseDate("2025-07-01")),
        { type: "MONTHS", length: 12, occurrences: 1 },
      ),
    ];
    const out = evaluateProgram(program, ctxInput());
    const p = presentSchedule(out);
    expect(p.valid).toBe(false);
    expect(p.projected).toBe(true); // the (over-allocating) projection is still shown
  });
});

// #464 — a top-level EARLIER OF cliff that commits to its time floor discloses the
// assumed-absent event. That disclosure is an EVENT_NOT_YET_OCCURRED blocker, so it
// lands in resolution.pending too — `present.pending` flips false→true while the
// event is unfired, exactly as the start case does (#363 AC-1/AC-5). Firing the
// event before the floor settles the fold (RESOLVED, not COMMITTED), so the
// disclosure and the pending flip both fall away.
describe("presentSchedule — #464 committed EARLIER OF cliff flips pending", () => {
  const prog = (dsl: string) => normalizeProgram(parse(dsl));
  const dsl =
    "VEST OVER 48 months EVERY 1 month CLIFF EARLIER OF (+12 months, EVENT fda)";

  it("fda unfired → present.pending true", () => {
    const out = evaluateProgram(prog(dsl), {
      grantDate: "2025-01-01",
      events: {},
      grantQuantity: 4800,
    });
    expect(out.resolution.status).toBe("template");
    expect(presentSchedule(out).pending).toBe(true);
  });

  it("fda fired before the floor → present.pending false", () => {
    const out = evaluateProgram(prog(dsl), {
      grantDate: "2025-01-01",
      events: { fda: "2025-07-01" },
      grantQuantity: 4800,
    });
    expect(out.resolution.status).toBe("template");
    expect(presentSchedule(out).pending).toBe(false);
  });
});

// #473 — the materiality rule flips `present.pending` on two nested combinator
// shapes, in opposite directions, because `pending` reads the resolution blocker
// list (not the status). A dominated nested START loses its only pending entry (the
// grid fully dates), while a material nested CLIFF gains one (the cliff now discloses
// its assumed-absent event). These lock the consumer-visible flip both ways.
describe("presentSchedule — #473 nested materiality flips pending both ways", () => {
  const prog = (dsl: string) => normalizeProgram(parse(dsl));

  it("dominated nested START → present.pending false (the vacuous disclosure is gone)", () => {
    // FROM LATER OF (EARLIER OF (DATE 06-01, e), DATE 09-01): the inner floor is
    // swamped, so under #473 it no longer discloses `e`. With nothing pending and the
    // start dated at 2024-09-01, the schedule reads not-pending. (Before #473 it
    // disclosed `e` vacuously and read pending.)
    const out = evaluateProgram(
      prog(
        "VEST FROM LATER OF (EARLIER OF (DATE 2024-06-01, EVENT e), DATE 2024-09-01) OVER 12 months EVERY 1 month",
      ),
      { grantDate: "2024-01-01", events: {}, grantQuantity: 120 },
    );
    expect(out.resolution.status).toBe("template");
    expect(presentSchedule(out).pending).toBe(false);
  });

  it("material nested CLIFF (anchored) → present.pending true (the cliff now discloses `e`)", () => {
    // OVER 48 months EVERY 1 month CLIFF LATER OF (EARLIER OF (DATE 09-01, e), DATE
    // 06-01): the inner floor 2024-09-01 is the unique strict max, so the cliff
    // discloses `e` into resolution.pending. (Before #473 the nested cliff was silent
    // and read not-pending.)
    const out = evaluateProgram(
      prog(
        "VEST OVER 48 months EVERY 1 month CLIFF LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-06-01)",
      ),
      { grantDate: "2024-01-01", events: {}, grantQuantity: 4800 },
    );
    expect(out.resolution.status).toBe("template");
    expect(presentSchedule(out).pending).toBe(true);
  });

  it("material nested CLIFF (deferred) → present.pending true", () => {
    // The deferred mirror: FROM EVENT g (unfired) holds the start, and the nested
    // cliff's inner floor is still the strict max, so the cliff discloses `e`. The
    // start's own `g` wait also keeps it pending; either way present.pending is true.
    const out = evaluateProgram(
      prog(
        "VEST FROM EVENT g OVER 48 months EVERY 1 month CLIFF LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-06-01)",
      ),
      { grantDate: "2024-01-01", events: {}, grantQuantity: 4800 },
    );
    expect(out.resolution.status).toBe("template");
    expect(presentSchedule(out).pending).toBe(true);
  });
});
