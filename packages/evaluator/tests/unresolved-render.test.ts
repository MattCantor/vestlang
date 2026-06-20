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
import { evaluateProgram } from "../src/orchestrate";
import { unresolvedInstallments } from "../src/resolve/unresolved.js";
import { baseCtx } from "./helpers";
import type { StmtResolution } from "../src/resolve/lower.js";

const DSL =
  "VEST FROM LATER OF(grantDate + 12 months, EVENT ipo) " +
  "OVER 48 months EVERY 1 month CLIFF EVENT board";

describe("partially-resolved combinator start keeps its START_PLUS cadence", () => {
  it("projects one START_PLUS tranche per occurrence, not a single lump", () => {
    const program = normalizeProgram(parse(DSL));
    const { resolution } = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {}, // ipo and board both unfired
      grantQuantity: 4800,
    });

    expect(resolution.status).toBe("unresolved");
    if (resolution.status !== "unresolved") return;

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

// The cliff mirror of the above: a partial `LATER OF` *cliff* (the +12mo arm
// resolves, the event is pending) records a `dated-floor` shape whose `floor` is
// the resolved lower bound. The unresolved renderer must fold every pre-cliff
// tranche onto that floor — not collapse the cliff to it, and not fold onto the
// grant date. grantDate (2025-01-01) and the floor (2026-01-01) differ here, so a
// tranche landing on the floor proves the renderer read `shape.floor`.
describe("partial LATER OF cliff folds pre-cliff tranches onto its floor", () => {
  const DSL =
    "VEST FROM grantDate OVER 48 months EVERY 1 month " +
    "CLIFF LATER OF(vestingStart + 12 months, EVENT ipo)";

  it("renders UNRESOLVED_CLIFF installments folded onto the 12-month floor", () => {
    const program = normalizeProgram(parse(DSL));
    const { resolution } = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {}, // ipo unfired → the cliff's later arm is pending
      grantQuantity: 4800,
    });

    expect(resolution.status).toBe("unresolved");
    if (resolution.status !== "unresolved") return;

    // Every installment is a cliff lump waiting on the event.
    expect(
      resolution.installments.every(
        (i) =>
          i.state === "UNRESOLVED" &&
          i.symbolicDate.type === "UNRESOLVED_CLIFF",
      ),
    ).toBe(true);
    // Some tranche folded onto the floor (start + 12mo), not the grant date.
    expect(
      resolution.installments.some(
        (i) =>
          i.state === "UNRESOLVED" &&
          i.symbolicDate.type === "UNRESOLVED_CLIFF" &&
          i.symbolicDate.date === "2026-01-01",
      ),
    ).toBe(true);
    // Shares are conserved across the fold.
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

// Reachability pin for the dated-start path: a known start with a *pending*
// cliff must render dated installments (UNRESOLVED_CLIFF), never the
// start-relative START_PLUS form. Here the start is a plain grant-date anchor
// (so it resolves) but the cliff waits on an unfired gated event, so the whole
// grid stays pending. The cliff being event-gated routes it through the
// deferred-shape machinery, which for a *resolved* start still yields a dated
// shape — proving the symbolic-cliff arm in the renderer stays unreachable.
describe("resolved start with a pending gated-event cliff renders dated, not START_PLUS", () => {
  const DSL =
    "VEST FROM grantDate OVER 4 months EVERY 1 month " +
    "CLIFF EVENT board BEFORE DATE 2030-01-01";

  it("renders every installment as UNRESOLVED_CLIFF and none as START_PLUS", () => {
    const program = normalizeProgram(parse(DSL));
    const { resolution } = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {}, // board unfired → the cliff stays pending
      grantQuantity: 400,
    });

    expect(resolution.status).toBe("unresolved");
    if (resolution.status !== "unresolved") return;

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
