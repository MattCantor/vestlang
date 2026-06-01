// The consumer rule, made explicit. `presentSchedule` derives three orthogonal
// reads — representable (status), pending (blockers, NOT status === "unresolved"),
// projected (installments). The load-bearing case is a pending-template: status
// "template" AND blockers present must read representable-but-pending, not
// complete.

import { describe, it, expect } from "vitest";
import type {
  Amount,
  Blocker,
  EvaluatedSchedule,
  EvaluationContextInput,
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

// presentSchedule reads only status / blockers / installments, so stub the rest.
const stub = (
  status: EvaluatedSchedule["status"],
  blockers: Blocker[],
  installments: Installment[],
): EvaluatedSchedule =>
  ({ status, blockers, installments }) as unknown as EvaluatedSchedule;

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

describe("presentSchedule — the three orthogonal reads", () => {
  it("template + blockers (pending-template) → representable AND pending", () => {
    expect(presentSchedule(stub("template", eventBlocker, dated))).toEqual({
      representable: true,
      pending: true,
      projected: true,
    });
  });

  it("template, no blockers, dated → representable, not pending, projected", () => {
    expect(presentSchedule(stub("template", [], dated))).toEqual({
      representable: true,
      pending: false,
      projected: true,
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
    });
  });
});
