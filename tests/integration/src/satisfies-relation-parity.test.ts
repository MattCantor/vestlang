// Cross-package parity oracle for the per-edge BEFORE/AFTER strictness rule.
//
// The meaning of bare vs STRICTLY BEFORE/AFTER lives in one place now —
// core's `satisfiesRelation` — but it's consumed twice: the evaluator uses it to
// decide whether a fixed-date proviso is satisfiable, and the linter uses it (via
// its emptiness check) to flag a gate window that can never hold the anchor. This
// test pins both consumers — and the primitive itself — to one hand-written
// truth table, so a future edit that quietly shifts an encoding (the linter's
// comparators/witness machinery, or even satisfiesRelation itself) breaks here.
//
// The expected outcomes are derived by hand from the spec, NOT from
// satisfiesRelation, on purpose: if the oracle called the same primitive the
// production code does, a mutation of that primitive would move the oracle and
// both consumers in lockstep and the test would pass vacuously. An independent
// table is what gives the test teeth.
//
// Surface: anchor-containment. Each cell is a DATE-anchored start carrying a
// BEFORE/AFTER proviso against a fixed base date —
//   VEST FROM DATE <anchor> [STRICTLY] <relation> DATE <base> OVER 4 months EVERY 1 month
// The anchor either sits inside the gate window (live) or outside it (dead). We
// span the base with anchors before / equal-to / after it so each (relation,
// strict) pair exercises its boundary day, and add date-range edge cells (the
// max/min representable dates) where the linter's witness step would otherwise
// overflow.
import { describe, it, expect } from "vitest";
import type {
  ConstraintTag,
  EvaluatedSchedule,
  OCTDate,
} from "@vestlang/types";
import { satisfiesRelation } from "@vestlang/primitives";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "@vestlang/evaluator";
import { lintText } from "@vestlang/linter";

const GRANT: OCTDate = "2024-01-01";

interface Cell {
  anchor: OCTDate;
  base: OCTDate;
  relation: ConstraintTag;
  strict: boolean;
  // Ground truth: the anchor CANNOT satisfy its proviso against the base, so the
  // gate is dead. By the spec — BEFORE wants anchor <= base (STRICTLY: <), AFTER
  // wants anchor >= base (STRICTLY: >).
  dead: boolean;
}

const BASE: OCTDate = "2025-06-01";
const EARLIER: OCTDate = "2025-01-01";
const LATER: OCTDate = "2025-12-31";

// The representable-range edges; toISO rejects anything past these.
const MAX: OCTDate = "9999-12-31";
const MIN: OCTDate = "0001-01-01";

const CELLS: Cell[] = [
  // BEFORE, bare: anchor <= base.
  {
    anchor: EARLIER,
    base: BASE,
    relation: "BEFORE",
    strict: false,
    dead: false,
  },
  { anchor: BASE, base: BASE, relation: "BEFORE", strict: false, dead: false },
  { anchor: LATER, base: BASE, relation: "BEFORE", strict: false, dead: true },
  // BEFORE, STRICTLY: anchor < base (the boundary day is now dead).
  {
    anchor: EARLIER,
    base: BASE,
    relation: "BEFORE",
    strict: true,
    dead: false,
  },
  { anchor: BASE, base: BASE, relation: "BEFORE", strict: true, dead: true },
  { anchor: LATER, base: BASE, relation: "BEFORE", strict: true, dead: true },
  // AFTER, bare: anchor >= base.
  { anchor: EARLIER, base: BASE, relation: "AFTER", strict: false, dead: true },
  { anchor: BASE, base: BASE, relation: "AFTER", strict: false, dead: false },
  { anchor: LATER, base: BASE, relation: "AFTER", strict: false, dead: false },
  // AFTER, STRICTLY: anchor > base (the boundary day is now dead).
  { anchor: EARLIER, base: BASE, relation: "AFTER", strict: true, dead: true },
  { anchor: BASE, base: BASE, relation: "AFTER", strict: true, dead: true },
  { anchor: LATER, base: BASE, relation: "AFTER", strict: true, dead: false },

  // Date-range edges — the gate bound sits on an extreme date while the anchor
  // stays normal, so every cell is dead (anchor nowhere near the bound) and the
  // evaluator never projects a schedule off the end of the range. The first is
  // the regression guard: a STRICTLY AFTER gate on the max date drives the
  // linter's emptiness witness to step one day past the last representable date
  // — it must short-circuit, not overflow. The others round out boundary
  // coverage (the bare max path, and the bottom-of-range mirror).
  { anchor: EARLIER, base: MAX, relation: "AFTER", strict: true, dead: true },
  { anchor: EARLIER, base: MAX, relation: "AFTER", strict: false, dead: true },
  { anchor: LATER, base: MIN, relation: "BEFORE", strict: true, dead: true },
  { anchor: LATER, base: MIN, relation: "BEFORE", strict: false, dead: true },
];

function program(c: Cell): string {
  const proviso = `${c.strict ? "STRICTLY " : ""}${c.relation}`;
  return `VEST FROM DATE ${c.anchor} ${proviso} DATE ${c.base} OVER 4 months EVERY 1 month`;
}

// Linter verdict: does the unsatisfiable-date-window rule fire on this program?
// (For an anchor outside its gate window it reports "anchor … falls outside …".)
function linterFails(src: string): boolean {
  return lintText(src).diagnostics.some(
    (d) => d.ruleId === "unsatisfiable-date-window",
  );
}

// Evaluator verdict, mirroring gate-oracle.test.ts: collapse the resolution
// verdict to whether the gate committed to impossible.
function evaluatorImpossible(src: string): boolean {
  const schedule: EvaluatedSchedule = evaluateProgram(
    normalizeProgram(parse(src)),
    { grantDate: GRANT, events: {}, grantQuantity: 100_000 },
  );
  return schedule.resolution.status === "impossible";
}

describe("satisfiesRelation parity — primitive ⟺ evaluator ⟺ linter", () => {
  for (const c of CELLS) {
    const variant = c.strict ? "STRICTLY " : "";
    const name = `${variant}${c.relation}: anchor ${c.anchor} vs base ${c.base} → ${
      c.dead ? "dead" : "live"
    }`;
    it(name, () => {
      const src = program(c);

      // The primitive answers the per-edge question directly; a live gate is one
      // the anchor satisfies. Pinning it to the hand-written table is what catches
      // a mutation of satisfiesRelation itself (the consumers below would mutate
      // with it and still agree, but the table would not).
      expect(satisfiesRelation(c.relation, c.strict, c.anchor, c.base)).toBe(
        !c.dead,
      );
      // Both consumers must reach the same verdict the table demands.
      expect(linterFails(src)).toBe(c.dead);
      expect(evaluatorImpossible(src)).toBe(c.dead);
    });
  }
});
