// When a start can't pin a date but its cadence is still known — a LATER OF whose
// later arm has already resolved, leaving only an unfired event to wait on — the
// unresolved projection lays the schedule out as per-tranche `start + N` symbolic
// installments, not one undated lump. That detail tells a record-keeper the shape
// of the schedule even before the anchor is known, so it must survive the move to
// rendering from the resolution record.
//
// `LATER OF(grantDate + 12 months, EVENT ipo)` start (the +12mo arm resolves, ipo
// pending) over a 48-month grid, with an event cliff that keeps the whole program
// unresolved. Each of the 48 tranches should be a START_PLUS step.

import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/evaluate";
import { unresolvedInstallments } from "../src/resolve/unresolved.js";
import { baseCtx } from "./helpers";
import type { StmtResolution } from "../src/resolve/lower.js";

const DSL =
  "VEST FROM LATER OF(grantDate + 12 months, EVENT ipo) " +
  "OVER 48 months EVERY 1 month CLIFF EVENT board";

describe("partially-resolved combinator start keeps its START_PLUS cadence", () => {
  it("projects one START_PLUS tranche per occurrence in the template's pending stream", () => {
    // `LATER OF(gd + 12mo, EVENT ipo)` start (combinator, ipo pending) + `CLIFF
    // EVENT board` → a COMPOUND template (a synthetic contingent start + the cliff's
    // event_condition). The combinator start's cadence still renders as START_PLUS
    // tranches, now in the template verdict's pending installments.
    const program = normalizeProgram(parse(DSL));
    const { resolution } = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {}, // ipo and board both unfired
      grantQuantity: 4800,
    });

    expect(resolution.status).toBe("template");
    if (resolution.status !== "template") return;

    expect(resolution.installments).toHaveLength(48);
    expect(
      resolution.installments.every(
        (i) => i.state === "UNRESOLVED" && i.symbolicDate.type === "START_PLUS",
      ),
    ).toBe(true);
    // No grant-date fold runs on this path, so the months count up cleanly: the
    // first tranche reads START + 1 month and the last START + 48 months.
    const steps = resolution.installments.map((i) =>
      i.state === "UNRESOLVED" && i.symbolicDate.type === "START_PLUS"
        ? i.symbolicDate.steps
        : undefined,
    );
    expect(steps).toEqual(Array.from({ length: 48 }, (_, i) => i + 1));
    expect(resolution.installments.every((i) => i.amount === 100)).toBe(true);
    expect(
      resolution.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });
});

// The cliff mirror of the above: `CLIFF LATER OF(vestingStart + 12mo, EVENT ipo)`
// on a dated start now stores as an event_condition (the time baseline in `cliff`,
// the event hold in `event_condition`). Unfired, the whole grid — including the
// 12-month lump — is held (AC 7: the floor is the hold, not an unresolved verdict).
// So it's a TEMPLATE that releases nothing; the held grid renders symbolically.
describe("partial LATER OF cliff holds the whole grid (the floor is the hold)", () => {
  const DSL =
    "VEST FROM grantDate OVER 48 months EVERY 1 month " +
    "CLIFF LATER OF(vestingStart + 12 months, EVENT ipo)";

  it("template; every share held as an UNRESOLVED_CLIFF tranche, nothing released", () => {
    const program = normalizeProgram(parse(DSL));
    const { resolution } = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {}, // ipo unfired → the event_condition holds
      grantQuantity: 4800,
    });

    expect(resolution.status).toBe("template");
    if (resolution.status !== "template") return;

    // The whole grid is held (no RESOLVED tranche), rendered as cliff lumps.
    expect(
      resolution.installments.every(
        (i) =>
          i.state === "UNRESOLVED" &&
          i.symbolicDate.type === "UNRESOLVED_CLIFF",
      ),
    ).toBe(true);
    // Shares are conserved in the held stream.
    expect(resolution.installments.reduce((sum, i) => sum + i.amount, 0)).toBe(
      4800,
    );
    expect(
      resolution.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });
});

// A resolved start with a gated event cliff (`CLIFF EVENT board BEFORE DATE …`)
// now stores as a SYNTHETIC event_condition (the gate captured in its recipe), so
// it's a template held until board fires. The held grid renders as dated cliff
// lumps (UNRESOLVED_CLIFF), never the start-relative START_PLUS form.
describe("resolved start with a pending gated-event cliff renders dated, not START_PLUS", () => {
  const DSL =
    "VEST FROM grantDate OVER 4 months EVERY 1 month " +
    "CLIFF EVENT board BEFORE DATE 2030-01-01";

  it("template; renders every held installment as UNRESOLVED_CLIFF and none as START_PLUS", () => {
    const program = normalizeProgram(parse(DSL));
    const { resolution } = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {}, // board unfired → the event_condition holds
      grantQuantity: 400,
    });

    expect(resolution.status).toBe("template");
    if (resolution.status !== "template") return;

    expect(resolution.installments.length).toBeGreaterThan(0);
    expect(
      resolution.installments.every(
        (i) =>
          i.state === "UNRESOLVED" &&
          i.symbolicDate.type === "UNRESOLVED_CLIFF",
      ),
    ).toBe(true);
    expect(
      resolution.installments.some(
        (i) => i.state === "UNRESOLVED" && i.symbolicDate.type === "START_PLUS",
      ),
    ).toBe(false);
  });
});

// White-box guard for the impossible dated-start + symbolic-cliff pairing. The
// real pipeline can't construct this record (a symbolic cliff only pairs with a
// pending start), so we hand-build one and call the renderer directly to prove
// it throws — and throws the *invariant* error, not some unrelated one from the
// fold/grid block that runs first. A coherent record (concrete date, head role,
// non-zero cadence) keeps that earlier block harmless, so the only thing left to
// blow up is the guarded arm.
describe("unresolvedInstallments rejects a dated start with a symbolic cliff", () => {
  it("throws naming the broken start/cliff-shape invariant", () => {
    const r: StmtResolution = {
      percentage: { numerator: 1, denominator: 1 },
      periodicity: { type: "MONTHS", length: 1, occurrences: 12 },
      start: { state: "RESOLVED", date: "2025-01-01", base: { type: "DATE" } },
      chain: { role: "head" },
      cliff: { state: "UNRESOLVED", blockers: [], shape: { kind: "symbolic" } },
    };

    expect(() => unresolvedInstallments(r, baseCtx(), 100)).toThrow(
      /symbolic/i,
    );
  });
});
