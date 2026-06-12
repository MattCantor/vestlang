// The consumer rule, made explicit. `presentSchedule` derives four orthogonal
// reads — representable (status), pending (blockers, NOT status === "unresolved"),
// projected (installments), valid (findings). The load-bearing case is a
// pending-template: status "template" AND blockers present must read
// representable-but-pending, not complete.

import { describe, it, expect } from "vitest";
import type {
  Amount,
  Blocker,
  EvaluatedSchedule,
  EvaluationContextInput,
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
import { presentSchedule } from "../src/present";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
} from "./helpers";

// presentSchedule reads the interchange status (representable), the resolution
// status/blockers/installments (pending, projected), and findings (valid), so
// stub exactly those. The interchange status defaults to the firing-invariant
// counterpart of the resolution status — the same except that a closed-world
// "unresolved" has no interchange equivalent and reads as "unrepresentable" — but
// a test can pass its own to exercise the two verdicts diverging. Findings default
// to none (a well-formed schedule).
const interchangeFor = (
  status: ResolutionStatus,
): InterchangeVerdict["status"] =>
  status === "unresolved" ? "unrepresentable" : status;

const stub = (
  status: ResolutionStatus,
  blockers: Blocker[],
  installments: Installment[],
  findings: Finding[] = [],
  interchangeStatus: InterchangeVerdict["status"] = interchangeFor(status),
): EvaluatedSchedule =>
  ({
    interchange: { status: interchangeStatus },
    resolution: { status, blockers, installments },
    absenceAssumptions: [],
    findings,
    cliffDate: null,
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
    unresolved: "ipo",
  },
];
const eventBlocker: Blocker[] = [
  { type: "EVENT_NOT_YET_OCCURRED", event: "ipo" },
];
const impossibleBlocker: Blocker[] = [
  { type: "IMPOSSIBLE_SELECTOR", selector: "EARLIER_OF", blockers: [] },
];

describe("presentSchedule — the orthogonal reads", () => {
  it("template + blockers (pending-template) → representable AND pending", () => {
    expect(presentSchedule(stub("template", eventBlocker, dated))).toEqual({
      representable: true,
      pending: true,
      projected: true,
      valid: true,
    });
  });

  it("template, no blockers, dated → representable, not pending, projected", () => {
    expect(presentSchedule(stub("template", [], dated))).toEqual({
      representable: true,
      pending: false,
      projected: true,
      valid: true,
    });
  });

  it("an error finding makes the schedule read invalid (separate from representable)", () => {
    const p = presentSchedule(stub("template", [], dated, overAllocated));
    expect(p.valid).toBe(false);
    expect(p.representable).toBe(true); // the interchange still holds it
  });

  it("a warning finding (under-allocation) leaves the schedule valid", () => {
    const p = presentSchedule(stub("template", [], dated, underAllocated));
    expect(p.valid).toBe(true); // only error-severity findings flip valid
  });

  it("annotate, don't certify: an over-allocating pending template stays projected", () => {
    // representable + pending + projected, but invalid — the legal partial
    // projection is still surfaced; it just isn't certified valid.
    const p = presentSchedule(
      stub("template", eventBlocker, dated, overAllocated),
    );
    expect(p).toEqual({
      representable: true,
      pending: true,
      projected: true,
      valid: false,
    });
  });

  it("events-only → representable, not pending", () => {
    const p = presentSchedule(stub("events-only", [], dated));
    expect(p.representable).toBe(true);
    expect(p.pending).toBe(false);
  });

  it("unresolved → pending, not representable (pending read off blockers, not status)", () => {
    const p = presentSchedule(stub("unresolved", eventBlocker, symbolic));
    expect(p.representable).toBe(false);
    expect(p.pending).toBe(true);
    expect(p.projected).toBe(false);
  });

  it("impossible (has blockers) → neither representable nor pending (terminal)", () => {
    const p = presentSchedule(stub("impossible", impossibleBlocker, []));
    expect(p.representable).toBe(false);
    expect(p.pending).toBe(false);
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
  const ctxInput = (): EvaluationContextInput => ({
    grantDate: "2025-01-01",
    events: {},
    grantQuantity: 4800,
    asOf: "2035-01-01",
  });

  it("75% MONTHLY + 25% unfired EVENT → template that is representable-but-pending", () => {
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
    const [out] = evaluateProgram(program, ctxInput()); // ipo unfired
    expect(out.resolution.status).toBe("template");
    expect(presentSchedule(out)).toEqual({
      representable: true,
      pending: true,
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
    const [out] = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: { a: "2025-06-01" },
      grantQuantity: 4800,
      asOf: "2035-01-01",
    });
    // The two verdicts come apart here, which is the whole point of splitting
    // them. Closed-world, with `a` fired late, the gated half is dead and the
    // program resolves to `unresolved`. But what's *storable* doesn't depend on
    // when `a` fired: a date grid plus a guarded event start is a perfectly good
    // template, so the storable verdict (and therefore `representable`) is true. A
    // different firing of `a` would resolve it.
    expect(out.resolution.status).toBe("unresolved");
    expect(out.interchange.status).toBe("template");
    expect(presentSchedule(out)).toEqual({
      representable: true, // storable as a template, independent of a's firing
      pending: true, // the void half carries IMPOSSIBLE_CONDITION blockers
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
    const [out] = evaluateProgram(program, ctxInput()); // ipo unfired
    expect(out.resolution.status).toBe("events-only");
    expect(presentSchedule(out)).toEqual({
      representable: true,
      pending: true, // the event portion's blocker survives the events arm
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
    const [out] = evaluateProgram(program, ctxInput());
    const p = presentSchedule(out);
    expect(p.valid).toBe(false);
    expect(p.projected).toBe(true); // the (over-allocating) projection is still shown
  });
});
