// A BEFORE/AFTER gate on a CLIFF must be reported whether or not the vesting
// start has fired. When the start is an unfired event the cliff has no date to
// land on, so it stays unresolved — but the gate is still a real condition the
// schedule is waiting on, and dropping it understates what the grant depends on.
//
// The regression: the program below starts on an unfired `hire` event and gates
// its cliff on `grantDate + 6 months`. With `hire` unfired the schedule resolves
// `unresolved`, and the gate must show up as an UNRESOLVED_CONDITION blocker
// alongside the pending `hire` — not be silently swallowed. When `hire` fires the
// cliff lands and the gate is enforced as before.

import { describe, it, expect } from "vitest";
import type { EvaluatedSchedule, UnresolvedBlocker } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/orchestrate";

const GRANT = "2025-01-01";
const QTY = 4800;

// `vestingStart + 12 months` cliff, gated so it only counts once it lands after
// `grantDate + 6 months`. 48 monthly tranches of 100 → a 12-month cliff lumps
// the first 1,200.
const DSL =
  "VEST FROM EVENT hire OVER 4 years EVERY 1 month " +
  "CLIFF vestingStart + 12 months AFTER grantDate + 6 months";

const run = (events: Record<string, string> = {}): EvaluatedSchedule => {
  const program = normalizeProgram(parse(DSL));
  const schedule = evaluateProgram(program, {
    grantDate: GRANT,
    events,
    grantQuantity: QTY,
  });
  return schedule;
};

const hasUnresolvedCondition = (blockers: UnresolvedBlocker[]): boolean =>
  blockers.some((b) => b.type === "UNRESOLVED_CONDITION");

describe("cliff-gate disclosure on an unfired-event start", () => {
  it("unfired start surfaces the cliff gate, not only the pending start", () => {
    const { resolution } = run();
    expect(resolution.status).toBe("unresolved");
    if (resolution.status !== "unresolved") return;

    // The pending start is reported... (both the start wait and the gate are
    // pending blockers — nothing is dead here)
    expect(
      resolution.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "hire",
      ),
    ).toBe(true);
    // ...and so is the cliff's `grantDate + 6 months` gate.
    expect(hasUnresolvedCondition(resolution.pending)).toBe(true);
    expect(resolution.dead).toHaveLength(0);
  });

  it("fired start enforces the gate and lands the cliff lump (unchanged)", () => {
    const { resolution } = run({ hire: "2025-03-01" });
    expect(resolution.status).toBe("template");
    if (resolution.status !== "template") return;

    const cliffLump = resolution.installments.find(
      (i) => i.state === "RESOLVED" && i.amount === 1200,
    );
    expect(cliffLump).toBeDefined();
    expect(cliffLump && "date" in cliffLump ? cliffLump.date : undefined).toBe(
      "2026-03-01",
    );
  });
});
