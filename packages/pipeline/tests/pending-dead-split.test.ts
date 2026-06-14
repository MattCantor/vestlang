// The pending/dead partition, end-to-end through the real evaluator. These pin the
// behaviors the brand split exists for: present.ts must read `pending` off the
// pending blocker list and `dead` off the dead one (never off a verdict status), and
// the schedule-level partition must honor the evaluator's selector routing — a dead
// arm an EARLIER_OF dropped does NOT bubble up to schedule-level `dead`.
//
// Each program is driven from DSL through parse → normalize → evaluate, then read
// through presentSchedule and toScheduleView (the two boundaries the split crosses).

import { describe, it, expect } from "vitest";
import type { EvaluationContextInput, Program } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "@vestlang/evaluator";
import { presentSchedule } from "../src/present";
import { toScheduleView } from "../src/view";

const evalDsl = (dsl: string, events: Record<string, string> = {}) => {
  const program: Program = normalizeProgram(parse(dsl));
  const ctx: EvaluationContextInput = {
    grantDate: "2025-01-01",
    events,
    grantQuantity: 4800,
    asOf: "2035-01-01",
  };
  return evaluateProgram(program, ctx)[0];
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

    expect(s.resolution.status).toBe("unresolved");
    const p = presentSchedule(s);
    expect(p.pending).toBe(false);
    expect(p.dead).toBe(true);
    expect(s.resolution.pending).toHaveLength(0);
    expect(s.resolution.dead).toHaveLength(1);
    expect(s.resolution.dead[0].type).toBe("IMPOSSIBLE_CONDITION");
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

    expect(s.resolution.pending.map((b) => b.type)).toEqual([
      "EVENT_NOT_YET_OCCURRED",
    ]);
    expect(s.resolution.dead.map((b) => b.type)).toEqual([
      "IMPOSSIBLE_CONDITION",
    ]);
    // Disjoint: no object is in both lists.
    const overlap = s.resolution.pending.filter((x) =>
      s.resolution.dead.some((y) => JSON.stringify(y) === JSON.stringify(x)),
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

      expect(s.resolution.pending).toHaveLength(0);
      expect(s.resolution.dead.map((b) => b.type)).toEqual([
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

      expect(s.resolution.dead).toHaveLength(0);
      expect(s.resolution.pending.map((b) => b.type)).toEqual([
        "UNRESOLVED_SELECTOR",
      ]);
      const p = presentSchedule(s);
      expect(p.pending).toBe(true);
      expect(p.dead).toBe(false);
    });
  });

  // AC#5b — the DEFERRED edge case, pinned (not fixed). A single statement that
  // ANDs a pending gate (BEFORE an unfired event) with a statically-impossible
  // constraint (AFTER a date the subject can't reach) emits a flat top-level list
  // mixing pending and impossible blockers — no selector involved — because the AND
  // combiner flattens children and a node is impossible only if EVERY blocker is
  // (packages/evaluator/src/evaluate/vestingNode/index.ts). The top-level partition
  // then routes that one statement into BOTH `pending` and `dead`.
  //
  // This is more honest than pre-split (which hid the deadness as pure "pending"),
  // but imperfect. The proper fix is a node-classification change — an explicit
  // non-goal here, filed as a follow-up (cross-links #287, #291). When that lands,
  // this assertion must be updated deliberately.
  it("AC#5b: a statement ANDing a pending gate with a dead constraint lands in BOTH (deferred)", () => {
    const s = evalDsl(
      `VEST FROM DATE 2025-06-01 AFTER DATE 2026-01-01 AND BEFORE EVENT ipo ${yearly2}`,
    );

    expect(s.resolution.pending.map((b) => b.type)).toEqual([
      "EVENT_NOT_YET_OCCURRED",
      "UNRESOLVED_CONDITION",
    ]);
    expect(s.resolution.dead.map((b) => b.type)).toEqual([
      "IMPOSSIBLE_CONDITION",
    ]);

    // present.ts therefore reports the statement as BOTH pending AND dead — the
    // pinned imperfection.
    const p = presentSchedule(s);
    expect(p.pending).toBe(true);
    expect(p.dead).toBe(true);
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
