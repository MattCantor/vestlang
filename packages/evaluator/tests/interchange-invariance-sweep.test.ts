// A corpus-level net for the interchange verdict's defining property: the
// "storable" answer must not move when an event fires. The verdict is computed
// against an events-blind context (resolveInterchange blanks the events map
// before any lowering), so in principle *no* program's interchange verdict can
// depend on firings. This sweep runs a spread of shapes through three event
// contexts and pins that equality, so the day someone breaks the blanking — or
// lets a firing reach lowering through some other channel — a test goes red.
//
// The companion check carries the real weight: for a schedule that references no
// events at all, a closed-world `template` must come with a storable `template`.
// That ties the two verdicts together rather than re-asserting the axis the
// interchange verdict already discards.

import { describe, it, expect } from "vitest";
import { CONTINGENT_START_SENTINEL } from "@vestlang/primitives";
import type {
  Amount,
  ResolutionContextInput,
  Program,
  Statement,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { walk, referencesEvent } from "@vestlang/walk";
import { evaluateProgram } from "../src/evaluate";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeVestingBaseGrantDate,
  makeVestingBaseVestingStart,
  makeGatedNode,
  makeDuration,
} from "./helpers";

const portion = (numerator: number, denominator: number): Amount => ({
  type: "PORTION",
  numerator,
  denominator,
});

const stmt = (
  amount: Amount,
  start: VestingNodeExpr<"GRANT_DATE">,
  periodicity: VestingPeriod,
): Statement => ({
  type: "STATEMENT",
  amount,
  expr: makeSingletonSchedule(start, periodicity),
});

// A THEN tail: no start of its own (the chaining walk injects one from the head).
const chainedTail = (periodicity: VestingPeriod): Statement => ({
  type: "STATEMENT",
  chained: true,
  amount: portion(1, 2),
  expr: { type: "SCHEDULE", vesting_start: null, periodicity },
});

const monthly48: VestingPeriod = { type: "MONTHS", length: 1, occurrences: 48 };

// Each corpus entry is a whole program plus the firing map it was authored with.
// `events` is the program's "own" context (context (a) of the sweep); the other
// two contexts are derived from the program's structure, not declared here.
interface CorpusEntry {
  name: string;
  program: Program;
  events: Record<string, string>;
}

// A LATER OF start with one calendar-date arm and one event arm, built as a plain
// literal — there's no selector constructor in the helpers. Firing the event arm
// is meaningful here (it's one of the two candidates the picker compares), which
// is what makes context (c) bite on this shape rather than slide past it.
const laterOfDateOrEvent: VestingNodeExpr<"GRANT_DATE"> = {
  type: "NODE_LATER_OF",
  items: [
    makeSingletonNode(makeVestingBaseDate("2026-01-01")),
    makeSingletonNode(makeVestingBaseEvent("ipo")),
  ],
};

// A nested mixed combinator: an outer LATER OF folding over an inner EARLIER OF that
// has a date arm and an event arm. Closed-world, the inner EARLIER OF commits to its
// date floor (leaning on `ipo` staying absent) and the outer LATER OF reads that
// floor — the #363 path. Firing-blind, no commit happens, so the storable verdict
// must be invariant to `ipo`. Two date orderings: one where the inner floor is the
// later of the two (the event is material), one where the outer date swamps it (the
// event is immaterial but still disclosed closed-world).
const nestedLaterOverEarlier = (
  innerDate: string,
  outerDate: string,
): VestingNodeExpr<"GRANT_DATE"> => ({
  type: "NODE_LATER_OF",
  items: [
    {
      type: "NODE_EARLIER_OF",
      items: [
        makeSingletonNode(makeVestingBaseDate(innerDate)),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    },
    makeSingletonNode(makeVestingBaseDate(outerDate)),
  ],
});

const corpus: CorpusEntry[] = [
  {
    // A start anchored to a bare event: nothing fired, the whole grid waits on it.
    name: "bare event start",
    program: [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
        monthly48,
      ),
    ],
    events: {},
  },
  {
    // Same, but the event start carries a BEFORE/AFTER gate. Firing it satisfies
    // the gate; the storable verdict still must not care.
    name: "gated event start",
    program: [
      stmt(
        portion(1, 1),
        makeGatedNode(
          makeVestingBaseEvent("ipo"),
          "AFTER",
          makeSingletonNode(makeVestingBaseDate("2025-06-01")),
        ),
        monthly48,
      ),
    ],
    events: { ipo: "2025-09-01" },
  },
  {
    // An offset anchor: grant date plus a year. Fully datable from the grant date
    // alone, references no events.
    name: "offset anchor (grantDate + 12 months)",
    program: [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseGrantDate(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
        monthly48,
      ),
    ],
    events: {},
  },
  {
    // Two independent absolute-date grids on one grant — firing-free, and a record
    // keeper models them as separate grants, so they don't collapse to one
    // template (events-only, both lenses).
    name: "two independent date grids",
    program: [
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 12,
          occurrences: 1,
        },
      ),
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2025-07-01")),
        {
          type: "MONTHS",
          length: 12,
          occurrences: 1,
        },
      ),
    ],
    events: {},
  },
  {
    // A single absolute-date grid — firing-free and storable as one template.
    // The witness the firing-free consistency check leans on.
    name: "single date grid",
    program: [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        monthly48,
      ),
    ],
    events: {},
  },
  {
    // LATER OF a date and an event for the start. Firing the event moves which
    // candidate wins closed-world; the storable answer ignores that.
    name: "LATER OF date-or-event start",
    program: [
      {
        type: "STATEMENT",
        amount: portion(1, 1),
        expr: {
          type: "SCHEDULE",
          vesting_start: laterOfDateOrEvent,
          periodicity: monthly48,
        },
      },
    ],
    events: { ipo: "2026-06-01" },
  },
  {
    // #363 — nested LATER OF (EARLIER OF (DATE, EVENT), DATE), inner floor material
    // (the inner date is the later of the two, so a firing of ipo could pull the
    // start earlier closed-world). Firing-blind the storable verdict ignores ipo.
    name: "nested LATER OF over committed EARLIER OF (material)",
    program: [
      {
        type: "STATEMENT",
        amount: portion(1, 1),
        expr: {
          type: "SCHEDULE",
          vesting_start: nestedLaterOverEarlier("2026-09-01", "2026-06-01"),
          periodicity: monthly48,
        },
      },
    ],
    events: { ipo: "2026-03-01" },
  },
  {
    // #363 — same nesting, inner floor immaterial (the outer date swamps it). The
    // closed-world reading still discloses ipo, but the storable verdict stays
    // firing-invariant — the property this sweep pins.
    name: "nested LATER OF over committed EARLIER OF (vacuous)",
    program: [
      {
        type: "STATEMENT",
        amount: portion(1, 1),
        expr: {
          type: "SCHEDULE",
          vesting_start: nestedLaterOverEarlier("2026-06-01", "2026-09-01"),
          periodicity: monthly48,
        },
      },
    ],
    events: { ipo: "2026-03-01" },
  },
  {
    // A THEN chain whose head waits on an unfired event: the tail can't be dated
    // until the head fires, so firing-blind it's unrepresentable (chained tail).
    name: "THEN chain behind a pending event head",
    program: [
      stmt(portion(1, 2), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 1,
        occurrences: 12,
      }),
      chainedTail({ type: "MONTHS", length: 1, occurrences: 12 }),
    ],
    events: {},
  },
  {
    // A cliff hung off a bare event. The schema has no home for an event-anchored
    // cliff, so it's unrepresentable however the firings fall.
    name: "bare event cliff",
    program: [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 1,
          occurrences: 48,
          cliff: makeSingletonNode(makeVestingBaseEvent("ipo")),
        },
      ),
    ],
    events: { ipo: "2026-01-01" },
  },
  {
    // Same event cliff with a BEFORE/AFTER gate. The gate can route how the cliff
    // resolves, but the event identity (and so the storable verdict) rides along.
    name: "gated event cliff",
    program: [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 1,
          occurrences: 48,
          cliff: makeGatedNode(
            makeVestingBaseEvent("acquisition"),
            "AFTER",
            makeSingletonNode(makeVestingBaseGrantDate(), [
              makeDuration(12, "MONTHS", "PLUS"),
            ]),
          ),
        },
      ),
    ],
    events: { acquisition: "2025-06-01" },
  },
  {
    // A duration cliff measured in the grid's own unit (months over a months
    // grid). It lowers anchor-free to a storable time-based cliff — firing-free.
    name: "grid-unit duration cliff",
    program: [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 1,
          occurrences: 48,
          cliff: makeSingletonNode(makeVestingBaseVestingStart(), [
            makeDuration(12, "MONTHS", "PLUS"),
          ]),
        },
      ),
    ],
    events: {},
  },
  {
    // A cross-unit duration cliff: a months cliff over a days grid. The pre-cliff
    // share can't be derived anchor-free, so it stays a deferred cliff. The start
    // is an event here, but the cliff cause is what wins firing-blind.
    name: "cross-unit (DEFERRED) duration cliff",
    program: [
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "DAYS",
        length: 30,
        occurrences: 48,
        cliff: makeSingletonNode(makeVestingBaseVestingStart(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
      }),
    ],
    events: {},
  },
  {
    // A mixed program that over-allocates: two copies of a full-grant statement
    // anchored on an event that fires past a BEFORE deadline (so it can never
    // satisfy the gate), summing to 200%.
    name: "mixed over-allocating program",
    program: (() => {
      const voidStart: VestingNode<"GRANT_DATE"> = {
        type: "NODE",
        base: makeVestingBaseEvent("a"),
        offsets: [],
        condition: {
          type: "ATOM",
          constraint: {
            type: "BEFORE",
            base: makeSingletonNode(makeVestingBaseDate("2025-01-01")),
            strict: false,
          },
        },
      };
      const s = stmt(portion(1, 1), voidStart, {
        type: "MONTHS",
        length: 12,
        occurrences: 2,
      });
      return [s, s];
    })(),
    events: { a: "2025-06-01" },
  },
];

// Every named event id reachable anywhere in a program — through start bases,
// offsets (which an event can't carry, but the walk descends them anyway), gate
// reference anchors, selector arms, and cliffs. Derived structurally from one
// traversal so the all-fired context and the firing-free predicate read the same
// set and can't quietly disagree about which events a program mentions.
const referencedEventIds = (program: Program): Set<string> => {
  const ids = new Set<string>();
  for (const statement of program) {
    walk(statement, (node) => {
      if (node.type === "EVENT") ids.add(node.value);
    });
  }
  return ids;
};

// A program references no events iff `referencesEvent` finds none in any
// statement. Shares the @vestlang/walk traversal with referencedEventIds, so a
// program that lands in the firing-free bucket is exactly one whose all-fired
// context is empty.
const isFiringFree = (program: Program): boolean =>
  !program.some((statement) => referencesEvent(statement));

// One date is enough — the point is that *some* firing is present for every
// referenced event, not which date it lands on.
const FIRED_DATE = "2027-03-01";

const allFired = (program: Program): Record<string, string> =>
  Object.fromEntries(
    [...referencedEventIds(program)].map((id) => [id, FIRED_DATE]),
  );

const ctxWith = (events: Record<string, string>): ResolutionContextInput => ({
  grantDate: "2025-01-01",
  events,
  grantQuantity: 100000,
});

describe("interchange — firing-invariance across a corpus of shapes", () => {
  it("covers at least ten distinct program shapes", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(10);
    expect(new Set(corpus.map((e) => e.name)).size).toBe(corpus.length);
  });

  it("a healthy majority of the corpus references at least one event", () => {
    const referencing = corpus.filter((e) => !isFiringFree(e.program)).length;
    expect(referencing * 2).toBeGreaterThan(corpus.length);
  });

  // The headline property, swept across every shape: own-events, no-events, and
  // every-referenced-event-fired all produce the identical storable verdict.
  for (const { name, program, events } of corpus) {
    it(`${name}: interchange verdict is identical across firing contexts`, () => {
      const own = evaluateProgram(program, ctxWith(events)).interchange;
      const none = evaluateProgram(program, ctxWith({})).interchange;
      const fired = evaluateProgram(
        program,
        ctxWith(allFired(program)),
      ).interchange;

      expect(none).toEqual(own);
      expect(fired).toEqual(own);
    });
  }
});

// #363 AC-4(a) — the COMMITTED arm that carries the nested disclosure arises only
// in `resolution` mode (the commit branch is mode-gated), so the firing-blind
// interchange read never commits and surfaces no absence assumption. The schedule's
// `absenceAssumptions` is the closed-world (resolution) read, so we assert the
// firing-blind verdict is a stable EVENT template — the storable floor — rather than
// anything that could have leaned on a firing.
describe("interchange — nested committed disclosures do not reach the storable verdict", () => {
  const nested363 = corpus.filter((e) => e.name.includes("EARLIER OF"));

  it("the nested LATER-over-EARLIER shapes are in the corpus", () => {
    expect(nested363.length).toBe(2);
  });

  for (const { name, program } of nested363) {
    it(`${name}: interchange is a firing-blind contingent-start template (no commitment)`, () => {
      const out = evaluateProgram(program, ctxWith({}));
      if (out.interchange.status !== "template")
        throw new Error(`expected interchange template for ${name}`);
      // The storable start is the contingent sentinel + an `evt:start` recipe, not
      // a committed date — the firing-blind path never commits, so nothing
      // absence-disclosure-shaped rode up into the storable verdict.
      expect(out.interchange.template.statements[0].vesting_base).toEqual({
        type: "DATE",
      });
      expect(out.interchange.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
      expect(Object.keys(out.interchange.sourceMap)).toEqual(["evt:start"]);
    });
  }
});

describe("interchange — the all-fired context is non-vacuous", () => {
  // Context (c) must fire at least every event the program's own context names,
  // or the sweep would be firing fewer events than the program references and
  // miss exactly the gap it exists to catch.
  it("every referenced-event id set is a superset of the entry's own events", () => {
    for (const { name, program, events } of corpus) {
      const referenced = referencedEventIds(program);
      for (const id of Object.keys(events)) {
        expect(referenced, `${name} references its own event ${id}`).toContain(
          id,
        );
      }
    }
  });

  it("every event-referencing entry yields a non-empty all-fired context", () => {
    for (const { name, program } of corpus) {
      if (isFiringFree(program)) continue;
      expect(
        Object.keys(allFired(program)).length,
        `${name} fires at least one event`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("interchange — firing-free programs tie the two verdicts together", () => {
  // For a schedule that mentions no events, a closed-world `template` must come
  // with a storable `template`. Nothing fired can be hiding the storability.
  for (const { name, program } of corpus.filter((e) =>
    isFiringFree(e.program),
  )) {
    it(`${name}: resolution template implies interchange template`, () => {
      const out = evaluateProgram(program, ctxWith({}));
      if (out.resolution.status === "template") {
        expect(out.interchange.status).toBe("template");
      }
    });
  }

  // The implication above is only worth anything if something actually satisfies
  // its antecedent: at least one firing-free shape that resolves to a template.
  it("at least one corpus entry is firing-free AND resolves to a template", () => {
    const witnesses = corpus.filter(
      (e) =>
        isFiringFree(e.program) &&
        evaluateProgram(e.program, ctxWith({})).resolution.status ===
          "template",
    );
    expect(witnesses.length).toBeGreaterThan(0);
  });
});
