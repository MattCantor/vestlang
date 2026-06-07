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
  Program,
  VestingNode,
  VestingPeriod,
} from "@vestlang/types";
import { presentSchedule } from "../src/present";
import { evaluateProgram } from "../src/evaluate/index";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
} from "./helpers";

// presentSchedule reads only status / blockers / installments / findings, so stub
// the rest. Findings default to none (a well-formed schedule).
const stub = (
  status: EvaluatedSchedule["status"],
  blockers: Blocker[],
  installments: Installment[],
  findings: Finding[] = [],
): EvaluatedSchedule =>
  ({
    status,
    blockers,
    installments,
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

const dated: Installment[] = [
  { amount: 100, date: "2025-02-01", meta: { state: "RESOLVED" } },
];
const symbolic: Installment[] = [
  {
    amount: 100,
    meta: {
      state: "UNRESOLVED",
      symbolicDate: { type: "UNRESOLVED_VESTING_START" },
      unresolved: "ipo",
    },
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
    start: VestingNode,
    periodicity: VestingPeriod,
  ) => ({
    type: "STATEMENT" as const,
    amount,
    expr: makeSingletonSchedule(start, periodicity),
  });
  const ctxInput = (): EvaluationContextInput => ({
    events: { grantDate: "2025-01-01" },
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
    expect(out.status).toBe("template");
    expect(presentSchedule(out)).toEqual({
      representable: true,
      pending: true,
      projected: true,
      valid: true,
    });
  });

  it("[resolving, void] → unresolved yet projected (resolved tranches present)", () => {
    const voidStart: VestingNode = {
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
      events: { grantDate: "2025-01-01", a: "2025-06-01" },
      grantQuantity: 4800,
      asOf: "2035-01-01",
    });
    expect(out.status).toBe("unresolved");
    expect(presentSchedule(out)).toEqual({
      representable: false,
      pending: true, // the void half carries IMPOSSIBLE_CONDITION blockers
      projected: true, // the resolved half's dated tranches are now surfaced
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
