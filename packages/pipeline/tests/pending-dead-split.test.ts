// The pending/dead partition, end-to-end through the real evaluator. These pin the
// behaviors the brand split exists for: present.ts must read `pending` off the
// pending blocker list and `dead` off the dead one (never off a verdict status), and
// the schedule-level partition must honor the evaluator's selector routing — a dead
// arm an EARLIER_OF dropped does NOT bubble up to schedule-level `dead`.
//
// Each program is driven from DSL through parse → normalize → evaluate, then read
// through presentSchedule and toScheduleView (the two boundaries the split crosses).

import { describe, it, expect } from "vitest";
import type { ResolutionContextInput, Program } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "@vestlang/evaluator";
import { presentSchedule } from "../src/present";
import { toScheduleView } from "../src/view";

const evalDsl = (dsl: string, events: Record<string, string> = {}) => {
  const program: Program = normalizeProgram(parse(dsl));
  const ctx: ResolutionContextInput = {
    grantDate: "2025-01-01",
    events,
    grantQuantity: 4800,
  };
  return evaluateProgram(program, ctx);
};

const yearly2 = "OVER 24 months EVERY 12 months";

describe("present/view — pending vs dead split", () => {
  // AC#3 — one fully-dated statement plus one DEAD statement (its gating event
  // fired outside the window, so its start is a top-level IMPOSSIBLE node). The
  // schedule classifies `unresolved` (the void→impossible rollup needs EVERY
  // portion void), but nothing is actually waiting — so it must read pending:false,
  // dead:true. Pre-fix present.ts read this as pending:true.
  it("AC#3: a dated statement beside a dead one reads dead, not pending", () => {
    const s = evalDsl(
      `1/2 VEST FROM DATE 2025-01-01 ${yearly2} ` +
        `PLUS 1/2 VEST FROM EVENT a BEFORE DATE 2025-01-01 ${yearly2}`,
      { a: "2025-06-01" }, // a fires after the BEFORE deadline → that half is dead
    );

    expect(s.resolvesTo.status).toBe("unresolved");
    const p = presentSchedule(s);
    expect(p.pending).toBe(false);
    expect(p.dead).toBe(true);
    expect(s.resolvesTo.pending).toHaveLength(0);
    expect(s.resolvesTo.dead).toHaveLength(1);
    expect(s.resolvesTo.dead[0].type).toBe("IMPOSSIBLE_CONDITION");
  });

  // AC#4 — one dead statement and one statement genuinely waiting on an unfired
  // event. The two top-level blockers split cleanly: the waiter into `pending`, the
  // dead one into `dead`, with no overlap.
  it("AC#4: mixed dead + waiting (separate statements) is split, not folded", () => {
    const s = evalDsl(
      `1/2 VEST FROM EVENT a BEFORE DATE 2025-01-01 ${yearly2} ` +
        `PLUS 1/2 VEST FROM EVENT ipo ${yearly2}`,
      { a: "2025-06-01" }, // a dead; ipo unfired (still waiting)
    );

    expect(s.resolvesTo.pending.map((b) => b.type)).toEqual([
      "EVENT_NOT_YET_OCCURRED",
    ]);
    expect(s.resolvesTo.dead.map((b) => b.type)).toEqual([
      "IMPOSSIBLE_CONDITION",
    ]);
    // Disjoint: no object is in both lists.
    const overlap = s.resolvesTo.pending.filter((x) =>
      s.resolvesTo.dead.some((y) => JSON.stringify(y) === JSON.stringify(x)),
    );
    expect(overlap).toHaveLength(0);

    const p = presentSchedule(s);
    expect(p.pending).toBe(true);
    expect(p.dead).toBe(true);
  });

  // AC#5 — selector semantics are honored by the top-level partition.
  describe("AC#5: selector routing", () => {
    // LATER OF is poisoned by any dead arm → top-level IMPOSSIBLE_SELECTOR → dead.
    it("LATER OF (dead, pending) lands in dead, pending empty", () => {
      const s = evalDsl(
        `VEST FROM LATER OF (EVENT a BEFORE DATE 2025-01-01, EVENT ipo) ${yearly2}`,
        { a: "2025-06-01" },
      );

      expect(s.resolvesTo.pending).toHaveLength(0);
      expect(s.resolvesTo.dead.map((b) => b.type)).toEqual([
        "IMPOSSIBLE_SELECTOR",
      ]);
      const p = presentSchedule(s);
      expect(p.dead).toBe(true);
      expect(p.pending).toBe(false);
    });

    // EARLIER OF drops a dead arm and stays UNRESOLVED_SELECTOR while a live arm
    // remains → top-level lands in pending; the dropped dead arm must NOT surface
    // as schedule-level dead (a recursive flatten would wrongly promote it).
    it("EARLIER OF (dead, pending) lands in pending, dead empty", () => {
      const s = evalDsl(
        `VEST FROM EARLIER OF (EVENT a BEFORE DATE 2025-01-01, EVENT ipo) ${yearly2}`,
        { a: "2025-06-01" },
      );

      expect(s.resolvesTo.dead).toHaveLength(0);
      expect(s.resolvesTo.pending.map((b) => b.type)).toEqual([
        "UNRESOLVED_SELECTOR",
      ]);
      const p = presentSchedule(s);
      expect(p.pending).toBe(true);
      expect(p.dead).toBe(false);
    });
  });

  // AC#5b — a single statement whose start ANDs a still-waiting gate (BEFORE an
  // unfired event) with a constraint nothing can ever satisfy (a start of 2025-06-01
  // that must come AFTER 2026-01-01). An AND needs every conjunct, so the one dead
  // conjunct settles it: the whole start can never fire, and the waiting conjunct is
  // moot. The combiner drops the moot pending blocker and the node classifies
  // impossible — so this reads dead-only, not "both pending and dead". Because it's
  // the only statement, the whole schedule is impossible.
  it("AC#5b: a statement ANDing a waiting gate with a dead constraint reads dead-only", () => {
    const s = evalDsl(
      `VEST FROM DATE 2025-06-01 AFTER DATE 2026-01-01 AND BEFORE EVENT ipo ${yearly2}`,
    );

    expect(s.resolvesTo.status).toBe("impossible");
    expect(s.resolvesTo.pending).toHaveLength(0);
    expect(s.resolvesTo.dead.map((b) => b.type)).toEqual([
      "IMPOSSIBLE_CONDITION",
    ]);

    const p = presentSchedule(s);
    expect(p.pending).toBe(false);
    expect(p.dead).toBe(true);

    // The dead conjunct stands on its own, so dropping the moot waiting gate also
    // drops what it was waiting on: nothing is assumed absent (pre-fix this assumed
    // `ipo` stayed absent through the start date).
    expect(s.absenceAssumptions).toEqual([]);

    // And the storable agrees: the contradiction is a fixed-date one, so no
    // firing of `ipo` could rescue it — the record keeper can't hold this spec.
    expect(s.storable.status).toBe("impossible");
    expect(p.representable).toBe(false);
  });

  // AC#6 — the view surfaces both lists (no flat `blockers`), populated correctly.
  it("AC#6: toScheduleView exposes pendingBlockers and deadBlockers", () => {
    const s = evalDsl(
      `1/2 VEST FROM EVENT a BEFORE DATE 2025-01-01 ${yearly2} ` +
        `PLUS 1/2 VEST FROM EVENT ipo ${yearly2}`,
      { a: "2025-06-01" },
    );
    const view = toScheduleView(s);

    expect("blockers" in view).toBe(false);
    expect(view.pendingBlockers.map((b) => b.type)).toEqual([
      "EVENT_NOT_YET_OCCURRED",
    ]);
    expect(view.deadBlockers.map((b) => b.type)).toEqual([
      "IMPOSSIBLE_CONDITION",
    ]);
    expect(view.pending).toBe(true);
    expect(view.dead).toBe(true);
  });
});

// When a start (or a cliff gate) combines conditions, an operand that can't matter to
// the outcome must be dropped before the node is classified, so the statement doesn't
// report as both waiting and dead at once:
//   - AND needs every conjunct, so one dead conjunct kills it and the still-waiting
//     conjuncts beside it are moot.
//   - OR needs only one arm, so while any arm is still waiting the dead arms are moot;
//     only when every arm is dead is the OR itself a contradiction.
describe("moot-operand collapse in AND / OR starts", () => {
  // #287: an event-subject AND whose two conjuncts pin the date to a JOINTLY-empty
  // window (after 2026, before 2025) is dead, not waiting. Per-operand neither
  // conjunct is a contradiction — each is a satisfiable "wait, bounded on one side"
  // — so the combiner alone reads it as a storable template. The joint interval
  // analysis at the gated-node entry sees the windows don't overlap and classifies
  // the node impossible. Empty-window is firing-invariant, so both verdicts flip.
  it("an event-subject AND with a jointly-empty date window is impossible (#287)", () => {
    const s = evalDsl(
      `VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS`,
    );

    expect(s.storable.status).toBe("impossible");
    expect(s.resolvesTo.status).toBe("impossible");
    expect(s.resolvesTo.dead.map((b) => b.type)).toEqual([
      "IMPOSSIBLE_CONDITION",
    ]);

    const p = presentSchedule(s);
    expect(p.dead).toBe(true);
    expect(p.representable).toBe(false);
  });

  // A conjunct that's dead only because of a known firing (an event fired past its
  // BEFORE deadline) still kills the AND in the resolves-to reading. But firing-blind
  // that event is unknown, so the same conjunct merely waits — the storable keeps
  // the spec as a storable template.
  it("a firing-dead AND conjunct collapses in resolvesTo but not in storable", () => {
    const s = evalDsl(
      `VEST FROM EVENT a BEFORE DATE 2025-01-01 AND BEFORE EVENT ipo ${yearly2}`,
      { a: "2025-06-01" }, // a fires after the BEFORE deadline → that conjunct is dead
    );

    expect(s.resolvesTo.status).toBe("impossible");
    expect(s.resolvesTo.pending).toHaveLength(0);
    expect(s.resolvesTo.dead.map((b) => b.type)).toEqual([
      "IMPOSSIBLE_CONDITION",
    ]);

    expect(s.storable.status).toBe("template");
    const p = presentSchedule(s);
    expect(p.representable).toBe(true);
  });

  // The OR mirror of AC#5b: one arm is a fixed contradiction, the other still waits on
  // an unfired event. The waiting arm can still satisfy the OR, so the dead arm is moot
  // and gets dropped — the statement reads waiting, not dead.
  it("an OR start with a live arm drops the dead arm (waiting, not dead)", () => {
    const s = evalDsl(
      `VEST FROM DATE 2025-06-01 AFTER DATE 2026-01-01 OR BEFORE EVENT ipo ${yearly2}`,
    );

    expect(s.resolvesTo.status).toBe("template");
    expect(s.resolvesTo.dead).toEqual([]);
    expect(s.resolvesTo.pending.map((b) => b.type)).toEqual([
      "EVENT_NOT_YET_OCCURRED",
      "UNRESOLVED_CONDITION",
    ]);

    const p = presentSchedule(s);
    expect(p.pending).toBe(true);
    expect(p.dead).toBe(false);
    expect(s.storable.status).toBe("template");
    expect(p.representable).toBe(true);
  });

  // The OR guard: when every arm is a contradiction there's no live arm to defer to,
  // so the OR itself is impossible and keeps all the dead arms' blockers.
  it("an OR start with every arm dead stays impossible and keeps all arms", () => {
    const s = evalDsl(
      `VEST FROM DATE 2025-06-01 AFTER DATE 2026-01-01 OR AFTER DATE 2027-01-01 ${yearly2}`,
    );

    expect(s.resolvesTo.status).toBe("impossible");
    expect(s.resolvesTo.pending).toHaveLength(0);
    expect(s.resolvesTo.dead.map((b) => b.type)).toEqual([
      "IMPOSSIBLE_CONDITION",
      "IMPOSSIBLE_CONDITION",
    ]);

    const p = presentSchedule(s);
    expect(p.dead).toBe(true);
    expect(p.pending).toBe(false);
  });

  // A cliff can carry its own gate condition, resolved through the same combiner. A
  // cliff gated on AND(dead, waiting) collapses the same way: the gate node flips to a
  // contradiction, so the cliff is a dead end rather than an event cliff — every
  // installment is unreachable.
  it("a cliff gated on AND(dead, waiting) collapses to dead-only", () => {
    const s = evalDsl(
      `VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month ` +
        `CLIFF vestingStart + 12 months AFTER DATE 2030-01-01 AND BEFORE EVENT ipo`,
    );

    // The whole schedule is unreachable: dead-only, nothing waiting.
    expect(s.resolvesTo.status).toBe("impossible");
    expect(s.resolvesTo.pending).toHaveLength(0);
    expect(s.resolvesTo.dead.map((b) => b.type)).toEqual([
      "IMPOSSIBLE_CONDITION",
    ]);

    const p = presentSchedule(s);
    expect(p.pending).toBe(false);
    expect(p.dead).toBe(true);
    expect(p.representable).toBe(false);

    // No event is assumed absent (the waiting `ipo` gate dropped), and every
    // installment is marked unreachable (it's a contradiction, not an event cliff).
    expect(s.absenceAssumptions).toEqual([]);
    expect(
      s.resolvesTo.installments.every((i) => i.state === "IMPOSSIBLE"),
    ).toBe(true);
    expect(s.storable.status).toBe("impossible");
  });

  // Honest disclosure: two dead conjuncts both surface, not just the first.
  it("an AND with two dead conjuncts carries both blockers", () => {
    const s = evalDsl(
      `VEST FROM DATE 2025-06-01 AFTER DATE 2026-01-01 AND AFTER DATE 2027-01-01 ${yearly2}`,
    );

    expect(s.resolvesTo.dead.map((b) => b.type)).toEqual([
      "IMPOSSIBLE_CONDITION",
      "IMPOSSIBLE_CONDITION",
    ]);

    const p = presentSchedule(s);
    expect(p.dead).toBe(true);
    expect(p.pending).toBe(false);
  });

  // Nesting — the load-bearing case. The drop decision is made per operand, asking
  // "is THIS operand impossible" rather than scanning the flattened list. So an OR
  // child that still has a live arm reads as waiting to the AND above it, and its
  // inner dead arm does not leak up into the schedule's dead list.
  it("AND(OR(dead, waiting), satisfied) stays waiting (the OR's dead arm doesn't leak)", () => {
    const s = evalDsl(
      `VEST FROM DATE 2025-06-01 (AFTER DATE 2026-01-01 OR BEFORE EVENT ipo) ` +
        `AND AFTER DATE 2020-01-01 ${yearly2}`,
    );

    expect(s.resolvesTo.status).toBe("template");
    expect(s.resolvesTo.dead).toEqual([]);
    expect(s.resolvesTo.pending.map((b) => b.type)).toEqual([
      "EVENT_NOT_YET_OCCURRED",
      "UNRESOLVED_CONDITION",
    ]);

    const p = presentSchedule(s);
    expect(p.dead).toBe(false);
    expect(p.pending).toBe(true);
  });

  // Same nesting shape, but now the OR child has no live arm — both arms are dead — so
  // the child reads impossible to the AND, and the whole start collapses to dead.
  it("AND(OR(dead, dead), satisfied) collapses to dead", () => {
    const s = evalDsl(
      `VEST FROM DATE 2025-06-01 (AFTER DATE 2026-01-01 OR AFTER DATE 2027-01-01) ` +
        `AND AFTER DATE 2020-01-01 ${yearly2}`,
    );

    expect(s.resolvesTo.status).toBe("impossible");
    expect(s.resolvesTo.pending).toHaveLength(0);
    expect(s.resolvesTo.dead.map((b) => b.type)).toEqual([
      "IMPOSSIBLE_CONDITION",
      "IMPOSSIBLE_CONDITION",
    ]);

    const p = presentSchedule(s);
    expect(p.dead).toBe(true);
    expect(p.pending).toBe(false);
  });
});
