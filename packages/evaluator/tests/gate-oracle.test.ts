// gate-oracle.test.ts — the BEFORE/AFTER proviso correctness floor, as an
// exhaustive, table-driven oracle.
//
// WHAT THIS IS. Each row is one cell of the gate truth surface, driven through
// the *real* evaluate path (parse → normalize → evaluateProgram) at the same
// altitude a user sees — DSL + grant + events + asOf → verdict. `correct` is the
// NORMATIVE claim (what the verdict *should* be); it is not a recording of what
// the engine does today. Contrast tests/constraint.test.ts, which calls
// evaluateConstraint() with hand-built RESOLVED/UNRESOLVED nodes: that unit test
// passes on the bugs below, because the bug is not in the cell's logic given its
// inputs — it is that vestingBase hands the cell the wrong input (a known future
// date marked UNRESOLVED purely because the wall clock hasn't reached it). Only a
// behavioral oracle with asOf as an explicit column can see that class, which is
// why this file exists alongside the unit test, not instead of it.
//
// THE FLOOR INVARIANT (the single property every row encodes):
//   A BEFORE/AFTER comparison is a function of its operands' KNOWN VALUES only.
//   An operand whose value is known — a literal date (any date, regardless of
//   whether asOf has reached it) or a fired event — participates in the
//   comparison. An operand whose value is unknown — an unfired event — makes the
//   comparison PENDING, never silently true or false. The asOf clock may decide
//   whether a standalone anchor has occurred yet; it must never decide whether
//   one known value precedes another.
//
// GREEN-BUT-HONEST LEDGER. Rows the engine does not yet satisfy carry
// `currentlyWrong: true` and run under it.fails, so the suite is GREEN today
// while still asserting the correct target. `currentlyWrong` is a ledger marker
// of a known gap, NOT a correctness claim — when a floor fix lands, the it.fails
// row starts passing, Vitest reports it as unexpectedly-passing, and that forces
// you to delete the flag and promote it to a plain assertion. Mislabels
// self-surface: a wrong `currentlyWrong:false` fails as a normal red; a wrong
// `currentlyWrong:true` fails because it.fails saw the body pass.
//
// `basis` records WHY a row's `correct` is what it is, so each normative claim is
// ratifiable on its own line:
//   - "direct"          both operands' values are known; just compare them. Rock
//                       solid — not a judgment call.
//   - "clock-invariance" both values known, but the engine's verdict flips with
//                       asOf. The bug is unambiguous: two known values cannot have
//                       a clock-dependent ordering.
//   - "open-world"      an operand's value is unknown (unfired event). Rests on
//                       the spec's mandatory-backdating premise (an unfired event
//                       may later be attested with any effective date, so absence
//                       never settles a comparison). The most contestable basis —
//                       review these first.

import { describe, it, expect } from "vitest";
import type { EvaluatedSchedule, OCTDate } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/evaluate/index";

const GRANT = "2024-01-01";
const TODAY = "2026-06-07"; // a stable "now" for the asOf column

type Verdict = "vests" | "pending" | "impossible" | "events-only";

/** Collapse an EvaluatedSchedule to the one distinction the floor is about:
 *  did the gate silently commit (vests / impossible) or honestly wait (pending)?
 *  `unresolved` and a witness-pending `template` both read as "pending" — the
 *  floor cares whether a verdict was committed, not which lowering carried it. */
function verdictOf(s: EvaluatedSchedule): Verdict {
  const { status, installments } = s.resolution;
  switch (status) {
    case "impossible":
      return "impossible";
    case "events-only":
      return "events-only";
    case "unresolved":
      return "pending";
    case "template": {
      const resolved = installments.filter((i) => i.meta.state === "RESOLVED");
      return resolved.length > 0 ? "vests" : "pending";
    }
  }
}

function observe(
  dsl: string,
  asOf: OCTDate,
  events: Record<string, OCTDate> = {},
): Verdict {
  const program = normalizeProgram(parse(dsl));
  const [schedule] = evaluateProgram(program, {
    grantDate: GRANT,
    events,
    grantQuantity: 100_000,
    asOf,
  });
  return verdictOf(schedule);
}

interface Cell {
  /** Full DSL statement, written out so the table reads literally. */
  dsl: string;
  asOf: OCTDate;
  /** Fired events (event_id → firing date). Omit ⇒ event is unfired. */
  events?: Record<string, OCTDate>;
  correct: Verdict;
  basis: "direct" | "clock-invariance" | "open-world";
  why: string;
  /** Known gap today (runs under it.fails). Delete when the engine meets it. */
  currentlyWrong?: boolean;
}

const CADENCE = "OVER 2 years EVERY 1 year";
const g = (expr: string) => `VEST FROM ${expr} ${CADENCE}`;

// ─────────────────────────────────────────────────────────────────────────────
// Orientation 1 — EVENT <rel> DATE  (the deadline/window idiom the construct was
// designed for: "from the milestone, so long as it lands before/after a date").
// ─────────────────────────────────────────────────────────────────────────────
const EVENT_REL_DATE: Cell[] = [
  {
    dsl: g("EVENT e BEFORE DATE 2025-01-01"),
    asOf: TODAY,
    events: { e: "2024-06-01" },
    correct: "vests",
    basis: "direct",
    why: "e (2024-06-01) is before the deadline; both values known.",
  },
  {
    dsl: g("EVENT e BEFORE DATE 2025-01-01"),
    asOf: TODAY,
    events: { e: "2025-06-01" },
    correct: "impossible",
    basis: "direct",
    why: "e fired after a PAST deadline; both resolved, comparison runs.",
  },
  {
    // THE bug this investigation started from.
    dsl: g("EVENT e BEFORE DATE 2030-01-01"),
    asOf: TODAY,
    events: { e: "2030-06-01" },
    correct: "impossible",
    basis: "clock-invariance",
    why: "e (2030-06-01) fired after the deadline (2030-01-01) — both known. Engine vests only because asOf < deadline marks the date UNRESOLVED.",
  },
  {
    dsl: g("EVENT e BEFORE DATE 2025-01-01"),
    asOf: TODAY,
    correct: "pending",
    basis: "open-world",
    why: "e unfired; could later be attested before the past deadline. Engine commits to impossible.",
  },
  {
    dsl: g("EVENT e BEFORE DATE 2030-01-01"),
    asOf: TODAY,
    correct: "pending",
    basis: "open-world",
    why: "e unfired, deadline future — both indeterminate.",
  },
  {
    dsl: g("EVENT e AFTER DATE 2025-01-01"),
    asOf: TODAY,
    events: { e: "2025-06-01" },
    correct: "vests",
    basis: "direct",
    why: "e after a past deadline; both resolved.",
  },
  {
    dsl: g("EVENT e AFTER DATE 2025-01-01"),
    asOf: TODAY,
    events: { e: "2024-06-01" },
    correct: "impossible",
    basis: "direct",
    why: "e before the deadline, so not after it; both resolved.",
  },
  {
    // Symmetric partner of the headline bug, AFTER side.
    dsl: g("EVENT e AFTER DATE 2030-01-01"),
    asOf: TODAY,
    events: { e: "2031-01-01" },
    correct: "vests",
    basis: "clock-invariance",
    why: "e (2031) is after the deadline (2030) — both known. Engine calls it impossible only because the future date is UNRESOLVED.",
  },
  {
    dsl: g("EVENT e AFTER DATE 2025-01-01"),
    asOf: TODAY,
    correct: "pending",
    basis: "open-world",
    why: "e unfired, past deadline — could still fire after it.",
  },
  {
    dsl: g("EVENT e AFTER DATE 2030-01-01"),
    asOf: TODAY,
    correct: "pending",
    basis: "open-world",
    why: "e unfired, future deadline — both indeterminate.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Orientation 2 — DATE <rel> EVENT  (logically equivalent to EVENT <inverse> DATE,
// so it must give the matching verdict; the spec's "smoking gun" is that it does
// not). This is where negation-as-failure on the event operand bites hardest.
// ─────────────────────────────────────────────────────────────────────────────
const DATE_REL_EVENT: Cell[] = [
  {
    dsl: g("DATE 2025-01-01 BEFORE EVENT e"),
    asOf: TODAY,
    correct: "pending",
    basis: "open-world",
    why: "Equivalent to `EVENT e AFTER DATE 2025-01-01` (unfired ⇒ pending). Engine silently vests — the headline optimistic commit.",
  },
  {
    dsl: g("DATE 2030-01-01 BEFORE EVENT e"),
    asOf: TODAY,
    correct: "pending",
    basis: "open-world",
    why: "Future date + unfired event — both indeterminate.",
  },
  {
    dsl: g("DATE 2025-01-01 BEFORE EVENT e"),
    asOf: TODAY,
    events: { e: "2025-06-01" },
    correct: "vests",
    basis: "direct",
    why: "2025-01-01 is before e's firing (2025-06-01); both resolved.",
  },
  {
    dsl: g("DATE 2025-01-01 AFTER EVENT e"),
    asOf: TODAY,
    correct: "pending",
    basis: "open-world",
    why: "Equivalent to `EVENT e BEFORE DATE 2025-01-01` (unfired ⇒ pending). Engine commits to impossible — the pessimistic mirror of the optimistic commit.",
  },
  {
    dsl: g("DATE 2030-01-01 AFTER EVENT e"),
    asOf: TODAY,
    correct: "pending",
    basis: "open-world",
    why: "Future date + unfired event — both indeterminate.",
  },
  {
    dsl: g("DATE 2025-06-01 AFTER EVENT e"),
    asOf: TODAY,
    events: { e: "2025-01-01" },
    correct: "vests",
    basis: "direct",
    why: "2025-06-01 is after e's firing (2025-01-01); both resolved.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Orientation 3 — DATE <rel> DATE  (pure arithmetic; the verdict cannot depend on
// asOf, since both operands are literals). The cleanest demonstration that the
// asOf gate has no business inside a comparison.
// ─────────────────────────────────────────────────────────────────────────────
const DATE_REL_DATE: Cell[] = [
  {
    dsl: g("DATE 2025-01-01 BEFORE DATE 2025-06-01"),
    asOf: TODAY,
    correct: "vests",
    basis: "direct",
    why: "Two past literals, 01 < 06.",
  },
  {
    dsl: g("DATE 2025-06-01 BEFORE DATE 2025-01-01"),
    asOf: TODAY,
    correct: "impossible",
    basis: "direct",
    why: "Two past literals, 06 not before 01.",
  },
  {
    // Two literals, both in the future relative to asOf → engine collapses both
    // to UNRESOLVED and pends, though the ordering is fixed and knowable.
    dsl: g("DATE 2030-01-01 BEFORE DATE 2030-06-01"),
    asOf: TODAY,
    correct: "vests",
    basis: "clock-invariance",
    why: "Two literals, 01 < 06 — fixed forever. Engine pends only because both are after asOf.",
  },
  {
    dsl: g("DATE 2025-01-01 BEFORE DATE 2025-01-01"),
    asOf: TODAY,
    correct: "vests",
    basis: "direct",
    why: "Non-strict BEFORE on equal dates is satisfied (≤).",
  },
  {
    dsl: g("DATE 2025-01-01 STRICTLY BEFORE DATE 2025-01-01"),
    asOf: TODAY,
    correct: "impossible",
    basis: "direct",
    why: "Strict BEFORE on equal dates cannot hold (<).",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Orientation 4 — EVENT <rel> EVENT  (mixed firedness; one unknown operand pends).
// ─────────────────────────────────────────────────────────────────────────────
const EVENT_REL_EVENT: Cell[] = [
  {
    dsl: g("EVENT a BEFORE EVENT b"),
    asOf: TODAY,
    correct: "pending",
    basis: "open-world",
    why: "Both unfired — fully indeterminate.",
  },
  {
    dsl: g("EVENT a BEFORE EVENT b"),
    asOf: TODAY,
    events: { a: "2025-01-01", b: "2025-06-01" },
    correct: "vests",
    basis: "direct",
    why: "Both fired, a before b.",
  },
  {
    dsl: g("EVENT a BEFORE EVENT b"),
    asOf: TODAY,
    events: { a: "2025-01-01" },
    correct: "pending",
    basis: "open-world",
    why: "b unfired — its value is unknown, so the comparison cannot commit. Engine vests off a's firing alone.",
  },
  {
    dsl: g("EVENT a BEFORE EVENT b"),
    asOf: TODAY,
    events: { b: "2025-01-01" },
    correct: "pending",
    basis: "open-world",
    why: "a unfired — could later be attested before b. Engine commits to impossible.",
  },
];

const ORACLE: Array<[string, Cell[]]> = [
  ["EVENT <rel> DATE", EVENT_REL_DATE],
  ["DATE <rel> EVENT", DATE_REL_EVENT],
  ["DATE <rel> DATE", DATE_REL_DATE],
  ["EVENT <rel> EVENT", EVENT_REL_EVENT],
];

describe("gate oracle — BEFORE/AFTER proviso correctness floor", () => {
  for (const [orientation, cells] of ORACLE) {
    describe(orientation, () => {
      for (const c of cells) {
        const runner = c.currentlyWrong ? it.fails : it;
        const label = `[${c.basis}] ${c.dsl} @asOf ${c.asOf}${
          c.events ? ` ${JSON.stringify(c.events)}` : ""
        } → ${c.correct}  // ${c.why}`;
        runner(label, () => {
          expect(observe(c.dsl, c.asOf, c.events)).toBe(c.correct);
        });
      }
    });
  }
});
