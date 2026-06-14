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
import { evaluateProgram } from "../src/evaluate/index";

const DSL =
  "VEST FROM LATER OF(grantDate + 12 months, EVENT ipo) " +
  "OVER 48 months EVERY 1 month CLIFF EVENT board";

describe("partially-resolved combinator start keeps its START_PLUS cadence", () => {
  it("projects one START_PLUS tranche per occurrence, not a single lump", () => {
    const program = normalizeProgram(parse(DSL));
    const [{ resolution }] = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {}, // ipo and board both unfired
      grantQuantity: 4800,
      asOf: "2025-06-01",
    });

    expect(resolution.status).toBe("unresolved");
    if (resolution.status !== "unresolved") return;

    expect(resolution.installments).toHaveLength(48);
    expect(
      resolution.installments.every(
        (i) => i.state === "UNRESOLVED" && i.symbolicDate.type === "START_PLUS",
      ),
    ).toBe(true);
    expect(resolution.installments.every((i) => i.amount === 100)).toBe(true);
    expect(
      resolution.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });
});
