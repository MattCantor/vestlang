import { describe, expect, it } from "vitest";
import type { OCTDate, Program } from "@vestlang/types";
import { candidates } from "../src/analytic/families.js";
import { domCandidates, type Row } from "../src/analytic/solvers.js";

// Property tests pinning the two preference orders the analytic core relies on:
// the per-pattern day-of-month order, and the family order the driver iterates.
// (Correctness — that a winning candidate reproduces the stream — is measured by
// the experiments sweep; these lock the ORDER, since the first verifying
// candidate wins and a reordering would silently change which reading is chosen.)

function row(date: string, amount: number): Row {
  return { date: date, amount };
}
function total(rows: Row[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

// ---- candidate shape probes ----------------------------------------------------

function isChain(p: Program): boolean {
  return p.length > 1;
}
function hasCliff(p: Program): boolean {
  const s = p[0];
  return (
    p.length === 1 &&
    s.expr.type === "SCHEDULE" &&
    s.expr.periodicity.cliff != null
  );
}
function isBareLump(p: Program): boolean {
  const s = p[0];
  return (
    p.length === 1 &&
    s.expr.type === "SCHEDULE" &&
    s.expr.periodicity.length === 0
  );
}
function isPlainTrain(p: Program): boolean {
  return !isChain(p) && !hasCliff(p) && !isBareLump(p);
}

describe("per-pattern day-of-month order", () => {
  const cases: { name: string; dates: OCTDate[]; order: string[] }[] = [
    {
      name: "all day-1",
      dates: ["2024-02-01", "2024-03-01"] as OCTDate[],
      order: [
        "VESTING_START_DAY",
        "FIRST_DAY_OF_MONTH",
        "VESTING_START_DAY_MINUS_ONE",
      ],
    },
    {
      name: "month-end",
      dates: ["2024-02-29", "2024-03-31"] as OCTDate[],
      order: [
        "LAST_DAY_OF_MONTH",
        "VESTING_START_DAY",
        "VESTING_START_DAY_MINUS_ONE",
      ],
    },
    {
      name: "mid-month",
      dates: ["2024-02-10", "2024-03-10"] as OCTDate[],
      order: ["VESTING_START_DAY", "VESTING_START_DAY_MINUS_ONE"],
    },
  ];
  for (const c of cases) {
    it(`${c.name} → ${c.order.join(" < ")}`, () => {
      expect(domCandidates(c.dates).map((d) => d.dom)).toEqual(c.order);
    });
  }
});

describe("family order", () => {
  it("a single-row stream yields only single-tranche readings (bare lump last)", () => {
    const rows = [row("2024-06-01", 500)];
    const cands = [...candidates(rows, total(rows), "2024-01-01")];
    expect(cands.length).toBeGreaterThan(0);
    // no multi-row family ever fires: nothing chains
    expect(cands.every((c) => !isChain(c.program))).toBe(true);
    // the last reading is the bare dated lump
    expect(isBareLump(cands[cands.length - 1].program)).toBe(true);
  });

  it("plain uniform is offered before the cliff reading", () => {
    // a 2-month cliff lump (2) followed by two monthly singles
    const rows = [
      row("2024-03-01", 2),
      row("2024-04-01", 1),
      row("2024-05-01", 1),
    ];
    // Iterate lazily — this stream's full candidate set runs to ~2k entries
    // (the driver never materializes it either; it stops at the first verifying
    // candidate), and exhausting it here is pure wasted wall time.
    const gen = candidates(rows, total(rows), "2024-01-01");
    const first = gen.next().value;
    expect(first && isPlainTrain(first.program)).toBe(true);
    let cliffOfferedLater = false;
    for (const c of gen) {
      if (hasCliff(c.program)) {
        cliffOfferedLater = true;
        break;
      }
    }
    expect(cliffOfferedLater).toBe(true);
  });

  it("the THEN chain is offered only after the plain/cliff/fold readings", () => {
    // a monthly rate change (10× then 50×) — plain uniform fires first, THEN last
    const rows = [
      row("2024-02-01", 10),
      row("2024-03-01", 10),
      row("2024-04-01", 10),
      row("2024-05-01", 50),
      row("2024-06-01", 50),
      row("2024-07-01", 50),
    ];
    const cands = [...candidates(rows, total(rows), "2024-01-01")];
    expect(isPlainTrain(cands[0].program)).toBe(true);
    const firstThen = cands.findIndex((c) => isChain(c.program));
    expect(firstThen).toBeGreaterThan(0);
  });
});
