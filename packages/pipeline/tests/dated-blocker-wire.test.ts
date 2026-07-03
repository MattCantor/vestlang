// #469 — the dated EVENT_NOT_YET_OCCURRED blocker carries its boundary as one
// nested `boundary` sub-object (through + descriptor, present together), and that
// nesting must survive on every surface the blocker is emitted unrendered. The
// existing blocker wire tests use only BARE blockers (`{ type, event }`), so nothing
// else pins the nested shape ON THE WIRE for a DATED blocker — which is the whole
// point of collapsing the four flat fields into a present-together unit.
//
// `VEST FROM DATE 2025-01-01 AFTER EVENT ipo` is a storable template whose start is
// gated AFTER an unfired event: resolvesTo stays pending, and the pending blocker is
// dated (the gate's date is the boundary, `flips-to-impossible` because a firing on
// the wrong side kills the grant). We assert the nested boundary on two published
// surfaces: `pendingBlockers` in the pipeline view, and a persist → rehydrate
// round-trip.

import { describe, it, expect } from "vitest";
import type {
  ResolutionContextInput,
  Program,
  UnresolvedBlocker,
} from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "@vestlang/evaluator";
import { toScheduleView } from "../src/view";
import { runPersist, runRehydrate } from "../src/persist.js";

const DATED_GATE_DSL =
  "VEST FROM DATE 2025-01-01 AFTER EVENT ipo OVER 12 months EVERY 1 month";

// The boundary the gate stamps on the pending `ipo` blocker: a firing of `ipo` after
// the 2025-01-01 start would leave the AFTER gate unsatisfiable, so it's the
// dangerous side and the consequence is a dead grant.
const EXPECTED_BOUNDARY = {
  through: "2025-01-01",
  direction: "after",
  inclusive: false,
  consequence: "flips-to-impossible",
} as const;

type EventBlocker = Extract<
  UnresolvedBlocker,
  { type: "EVENT_NOT_YET_OCCURRED" }
>;

const findIpo = (bs: UnresolvedBlocker[]): EventBlocker | undefined =>
  bs.find(
    (b): b is EventBlocker =>
      b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
  );

describe("#469 dated blocker carries a nested boundary on the wire", () => {
  it("pendingBlockers in the pipeline view nests the boundary", () => {
    const program: Program = normalizeProgram(parse(DATED_GATE_DSL));
    const ctx: ResolutionContextInput = {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 1200,
    };
    const view = toScheduleView(evaluateProgram(program, ctx));

    const ipo = findIpo(view.pendingBlockers);
    expect(ipo).toBeDefined();
    expect(ipo?.boundary).toEqual(EXPECTED_BOUNDARY);
    // The flat fields are gone — the four travel only inside `boundary`.
    expect(ipo).not.toHaveProperty("through");
    expect(ipo).not.toHaveProperty("direction");
  });

  it("the nested boundary survives a persist → rehydrate round-trip", () => {
    const persisted = runPersist({
      dsl: DATED_GATE_DSL,
      grant_date: "2024-01-01",
      grant_quantity: 1200,
    });
    if (!persisted.ok)
      throw new Error(`expected persist ok: ${persisted.error.message}`);

    const persistedIpo = findIpo(persisted.pending);
    expect(persistedIpo).toBeDefined();
    expect(persistedIpo?.boundary).toEqual(EXPECTED_BOUNDARY);

    // Rehydrate with ipo still unfired: the gate re-derives the same dated boundary
    // off the stored artifact, so the nested shape round-trips byte-for-byte.
    const out = runRehydrate({
      artifact: persisted.artifact,
      grant_quantity: 1200,
    });
    if (!out.ok) throw new Error(`expected rehydrate ok: ${out.error.message}`);

    const rehydratedIpo = findIpo(out.pending);
    expect(rehydratedIpo).toBeDefined();
    expect(rehydratedIpo?.boundary).toEqual(EXPECTED_BOUNDARY);
  });
});
