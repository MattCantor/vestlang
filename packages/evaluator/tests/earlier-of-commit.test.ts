// Issue #251 — an EARLIER OF start (or cliff) with a settled date arm commits to
// that arm in the closed-world resolution verdict, instead of waiting forever on
// an unfired event sibling. The resolved arm is a lower bound on the start: a real
// firing can only land earlier and vest MORE, so the committed projection is a
// guaranteed floor. The firing-invariant interchange verdict is unaffected — it
// still externalizes the combinator as a synthetic event.

import { describe, it, expect } from "vitest";
import type { AsOfContextInput, Blocker } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/orchestrate";
import { evaluateProgramAsOf } from "../src/index";
import { evaluateProgramAsOf as asOf } from "../src/asof";

const ctx = (overrides: Partial<AsOfContextInput> = {}): AsOfContextInput => ({
  grantDate: "2024-01-01",
  events: {},
  grantQuantity: 120,
  asOf: "2026-06-01",
  ...overrides,
});

const prog = (dsl: string) => normalizeProgram(parse(dsl));

// Recursively search a blocker tree for the unfired-event leaf.
const findsEventNotOccurred = (bs: Blocker[], event: string): boolean =>
  bs.some(
    (b) =>
      (b.type === "EVENT_NOT_YET_OCCURRED" && b.event === event) ||
      ((b.type === "UNRESOLVED_SELECTOR" || b.type === "IMPOSSIBLE_SELECTOR") &&
        findsEventNotOccurred(b.blockers as Blocker[], event)),
  );

// The issue's repro shape: 12 monthly tranches off the earlier of a settled date
// and an unfired event, granted 2024-01-01 over 120 shares.
const REPRO =
  "VEST FROM EARLIER OF (DATE 2024-06-01, EVENT ipo) OVER 12 months EVERY 1 month";

describe("EARLIER OF start commit (#251)", () => {
  it("AC#1: the repro fully vests off the date arm by the as-of date", () => {
    const result = asOf(prog(REPRO), ctx());
    const total_vested = result.vested.reduce((a, x) => a + x.amount, 0);
    expect(total_vested).toBe(120);
    // percent_vested is a 0–1 fraction here (the engine's, not the 0–100 view).
    expect(total_vested / 120).toBe(1);
    // No shares are stranded as unschedulable — the floor placed all of them.
    expect(result.unresolved).toBe(0);
  });

  it("AC#2: discloses ipo in both channels (absenceAssumptions + resolution.pending)", () => {
    const schedule = evaluateProgram(prog(REPRO), ctx());
    // Absence-assumption channel: ipo assumed absent through the committed date.
    expect(schedule.absenceAssumptions).toContainEqual({
      eventId: "ipo",
      through: "2024-06-01",
    });
    // Blocker channel: the same unfired gate surfaces on resolution.pending.
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(findsEventNotOccurred(schedule.resolution.pending, "ipo")).toBe(
      true,
    );
  });

  it("AC#3: the interchange verdict is unchanged (firing-blind synthetic)", () => {
    const schedule = evaluateProgram(prog(REPRO), ctx());
    const { interchange } = schedule;
    if (interchange.status !== "template")
      throw new Error(
        `expected interchange template, got ${interchange.status}`,
      );
    // Firing-blind, the combinator externalizes as a synthetic event.
    const base = interchange.template.statements[0].vesting_base;
    expect(base.type).toBe("EVENT");
    expect(base.type === "EVENT" && base.event_id).toMatch(/^evt:/);
    expect(Object.keys(interchange.sourceMap).length).toBeGreaterThan(0);
  });

  // evaluateProgramAsOf is re-exported from the package root; pin that the as-of
  // view routes through the same committing resolveToCore path.
  it("the root as-of export commits the same way", () => {
    const result = evaluateProgramAsOf(prog(REPRO), ctx());
    expect(result.vested.reduce((a, x) => a + x.amount, 0)).toBe(120);
    expect(result.unresolved).toBe(0);
  });
});

describe("nested EARLIER OF floor (#251, AC#13)", () => {
  // LATER OF ( EARLIER OF (DATE 2024-06-01, EVENT ipo), DATE 2025-01-01 ): the
  // inner EARLIER OF commits to 2024-06-01, then the outer LATER OF takes the later
  // of that and 2025-01-01 → starts 2025-01-01. Committing the inner combinator to
  // its resolved arm makes the outer result as-late-as-possible, which is still a
  // vesting floor, so the projection is correct.
  const NESTED =
    "VEST FROM LATER OF ( EARLIER OF (DATE 2024-06-01, EVENT ipo), DATE 2025-01-01 ) OVER 12 months EVERY 1 month";

  it("the floor is correct — the program commits and fully vests", () => {
    const result = asOf(
      prog(NESTED),
      ctx({ grantQuantity: 120, asOf: "2026-06-01" }),
    );
    expect(result.vested.reduce((a, x) => a + x.amount, 0)).toBe(120);
    expect(result.unresolved).toBe(0);
    // The outer LATER OF wins on 2025-01-01, so the first tranche is a month later.
    const first = result.vested
      .filter((i) => i.state === "RESOLVED")
      .sort((a, b) =>
        a.state === "RESOLVED" && b.state === "RESOLVED"
          ? a.date < b.date
            ? -1
            : 1
          : 0,
      )[0];
    expect(first?.state === "RESOLVED" && first.date).toBe("2025-02-01");
  });

  it("documents the deferred disclosure gap: ipo is NOT in absenceAssumptions", () => {
    // The inner pick's stamped blockers are dropped at the outer LATER OF fold
    // (reduceBest/chooseBest read only picked/meta), so the still-pending ipo isn't
    // disclosed for a nested combinator. The floor stays correct; only the
    // disclosure is missing. This is the acknowledged gap deferred to #325 — pinned
    // here so a future reviewer sees it's intentional, not a silent omission.
    const schedule = evaluateProgram(prog(NESTED), ctx({ grantQuantity: 120 }));
    expect(schedule.absenceAssumptions.some((a) => a.eventId === "ipo")).toBe(
      false,
    );
  });
});
