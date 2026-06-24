// Closed-world resolution reads "no firing recorded" as "hasn't happened," so its
// answer can quietly depend on some event staying absent. `absenceAssumptions`
// surfaces those dependencies direction-aware: each carries the boundary date
// (`through`) plus the relation a dangerous firing would have to satisfy to move the
// result — `direction` (which side of the boundary) and `inclusive` (whether the
// boundary day itself is dangerous). A schedule that needs no such assumption (all
// dates, or every event already fired) discloses nothing.
//
// What counts as a disclosed assumption is the dated kind: the event was held
// against a known date — a gate's before/after, or the date a LATER OF already
// settled on. A bare wait with nothing to compare against (a plain FROM EVENT) is
// still pending, but it has no date to disclose, so it stays in the blocker list.

import { describe, it, expect } from "vitest";
import type {
  Amount,
  Blocker,
  ResolutionContextInput,
  OCTDate,
  Program,
  Statement,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateStatement, evaluateProgram } from "../src/evaluate";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
} from "./helpers";

const ctxInput = (
  overrides: Partial<ResolutionContextInput> = {},
): ResolutionContextInput => ({
  grantDate: "2025-01-01",
  events: {},
  grantQuantity: 100000,
  ...overrides,
});

const prog = (dsl: string) => normalizeProgram(parse(dsl));

// Evaluate a single-statement DSL program and read its disclosures.
const disclose = (dsl: string, grantDate: OCTDate = "2024-01-01") =>
  evaluateProgram(prog(dsl), ctxInput({ grantDate, grantQuantity: 1200 }))
    .absenceAssumptions;

const portion = (numerator: number, denominator: number): Amount => ({
  type: "PORTION",
  numerator,
  denominator,
});

const monthly: VestingPeriod = { type: "MONTHS", length: 1, occurrences: 48 };

const stmt = (
  amount: Amount,
  start: VestingNodeExpr<"GRANT_DATE">,
): Statement => ({
  type: "STATEMENT",
  amount,
  expr: makeSingletonSchedule(start, monthly),
});

// `FROM DATE <date> BEFORE EVENT <event>` — vest from a fixed date, on the
// understanding that the date lands before the event. While the event is unfired
// the test can't be settled, so the start stays pending and leans on the event
// not having occurred by that date.
const dateBeforeEvent = (
  date: OCTDate,
  event: string,
): VestingNode<"GRANT_DATE"> => ({
  type: "NODE",
  base: makeVestingBaseDate(date),
  offsets: [],
  condition: {
    type: "ATOM",
    constraint: {
      type: "BEFORE",
      base: makeSingletonNode(makeVestingBaseEvent(event)),
      strict: false,
    },
  },
});

// Pull a dated unfired-event blocker out of a pending list (descending selector
// arms), descriptor and all — for the unit assertions on the blocker shape.
const findUnfired = (
  bs: Blocker[],
  event: string,
):
  | { through?: OCTDate; direction?: "before" | "after"; inclusive?: boolean }
  | undefined => {
  for (const b of bs) {
    if (b.type === "EVENT_NOT_YET_OCCURRED" && b.event === event)
      return {
        through: b.through,
        direction: b.direction,
        inclusive: b.inclusive,
      };
    if (b.type === "UNRESOLVED_SELECTOR" || b.type === "IMPOSSIBLE_SELECTOR") {
      const hit = findUnfired(b.blockers as Blocker[], event);
      if (hit) return hit;
    }
  }
  return undefined;
};

describe("absenceAssumptions", () => {
  it("two starts gated on different events disclose both, each with its own date", () => {
    const program: Program = [
      stmt(portion(1, 2), dateBeforeEvent("2025-01-01", "ipo")),
      stmt(portion(1, 2), dateBeforeEvent("2026-03-01", "milestone")),
    ];
    const out = evaluateProgram(program, ctxInput());
    // A sound non-strict BEFORE gate holds iff `event >= date`, so a firing exactly
    // on the date keeps it valid — the dangerous window is "before the date",
    // exclusive. Direction `before`, inclusive false.
    expect(out.absenceAssumptions).toEqual([
      {
        eventId: "ipo",
        through: "2025-01-01",
        direction: "before",
        inclusive: false,
      },
      {
        eventId: "milestone",
        through: "2026-03-01",
        direction: "before",
        inclusive: false,
      },
    ]);
  });

  it("a plain date schedule assumes nothing", () => {
    const out = evaluateStatement(
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseDate("2025-01-01"))),
      ctxInput(),
    );
    expect(out.absenceAssumptions).toEqual([]);
  });

  it("once the gating event has fired there is no assumption left", () => {
    // ipo fired in 2030, comfortably after the 2025 start, so the before-test is
    // settled and the start just resolves — nothing is being assumed absent.
    const out = evaluateStatement(
      stmt(portion(1, 1), dateBeforeEvent("2025-01-01", "ipo")),
      ctxInput({ events: { ipo: "2030-01-01" } }),
    );
    expect(out.absenceAssumptions).toEqual([]);
  });

  it("a bare unfired-event start has no date to disclose, only a blocker", () => {
    const out = evaluateStatement(
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo"))),
      ctxInput(),
    );
    // The wait on ipo is real, but there's no date it was measured against, so it
    // isn't a dated assumption — it surfaces as a blocker instead (bare, no
    // descriptor).
    expect(out.absenceAssumptions).toEqual([]);
    expect(
      out.resolution.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });

  it("a LATER OF settled on a date assumes the pending arm stays absent after it", () => {
    // LATER OF ( DATE 2027-01-01, EVENT ipo ): the date has settled but ipo could
    // still land later and become the answer (shifting the whole grid). So the
    // dangerous firing is *after* 2027-01-01 — direction `after`, exclusive (a tie
    // keeps the date arm as the floor). #399 AC4.
    const laterOf: VestingNodeExpr<"GRANT_DATE"> = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseDate("2027-01-01")),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    };
    const program: Program = [
      {
        type: "STATEMENT",
        amount: portion(1, 1),
        expr: {
          type: "SCHEDULE",
          vesting_start: laterOf,
          periodicity: monthly,
        },
      },
    ];
    const out = evaluateProgram(program, ctxInput());
    expect(out.absenceAssumptions).toEqual([
      {
        eventId: "ipo",
        through: "2027-01-01",
        direction: "after",
        inclusive: false,
      },
    ]);
  });

  it("the same event assumed absent against two dates (same direction) collapses to the later one", () => {
    const program: Program = [
      stmt(portion(1, 2), dateBeforeEvent("2025-01-01", "ipo")),
      stmt(portion(1, 2), dateBeforeEvent("2026-03-01", "ipo")),
    ];
    const out = evaluateProgram(program, ctxInput());
    // Both are sound BEFORE gates (before/exclusive), so they share a relation group
    // and collapse to the later (wider) boundary.
    expect(out.absenceAssumptions).toEqual([
      {
        eventId: "ipo",
        through: "2026-03-01",
        direction: "before",
        inclusive: false,
      },
    ]);
  });
});

// #399 — the disclosure must point at the *dangerous* side of the boundary, not the
// benign one. Each case is verified against the reference table in docs/scratch.
describe("#399 — disclosure direction", () => {
  it("AC1: AFTER gate discloses the after side, exclusive", () => {
    // `d AFTER e` holds iff `e <= d`; a firing of e after d flips it to impossible,
    // a firing exactly on d is benign. Direction after, exclusive (inclusive false).
    expect(
      disclose(
        "VEST FROM DATE 2025-01-01 AFTER EVENT ipo OVER 12 months EVERY 1 month",
      ),
    ).toEqual([
      {
        eventId: "ipo",
        through: "2025-01-01",
        direction: "after",
        inclusive: false,
      },
    ]);
  });

  it("AC2: STRICTLY AFTER flips the boundary day to dangerous (inclusive)", () => {
    // `d STRICTLY AFTER e` holds iff `e < d`; a firing on/after d is dangerous, so
    // the boundary day is in the window — inclusive true.
    expect(
      disclose(
        "VEST FROM DATE 2025-01-01 STRICTLY AFTER EVENT ipo OVER 12 months EVERY 1 month",
      ),
    ).toEqual([
      {
        eventId: "ipo",
        through: "2025-01-01",
        direction: "after",
        inclusive: true,
      },
    ]);
  });

  it("AC3: a gated-event offset folds into the disclosed boundary", () => {
    // `d BEFORE EVENT ipo - 6 months` holds iff `ipo - 6mo >= d`, i.e. a raw
    // `ipo >= d + 6mo`. The disclosed boundary is the subject date shifted by the
    // negation of the event's `-6 months` → 2025-07-01, direction before, exclusive.
    expect(
      disclose(
        "VEST FROM DATE 2025-01-01 BEFORE EVENT ipo - 6 months OVER 12 months EVERY 1 month",
      ),
    ).toEqual([
      {
        eventId: "ipo",
        through: "2025-07-01",
        direction: "before",
        inclusive: false,
      },
    ]);
  });

  it("AC10: a sound non-strict BEFORE gate discloses before/exclusive (off-by-one fix)", () => {
    // `d BEFORE e` holds iff `e >= d`; a firing exactly on d keeps it valid, so the
    // dangerous window is strictly before d — exclusive. The boundary stays d.
    expect(
      disclose(
        "VEST FROM DATE 2025-01-01 BEFORE EVENT ipo OVER 12 months EVERY 1 month",
      ),
    ).toEqual([
      {
        eventId: "ipo",
        through: "2025-01-01",
        direction: "before",
        inclusive: false,
      },
    ]);
  });

  it("AC-H: STRICTLY BEFORE makes the boundary day dangerous (inclusive)", () => {
    // `d STRICTLY BEFORE e` holds iff `e > d`; a firing on/before d is dangerous, so
    // the boundary day is in the window — inclusive true.
    expect(
      disclose(
        "VEST FROM DATE 2025-01-01 STRICTLY BEFORE EVENT ipo OVER 12 months EVERY 1 month",
      ),
    ).toEqual([
      {
        eventId: "ipo",
        through: "2025-01-01",
        direction: "before",
        inclusive: true,
      },
    ]);
  });

  it("AC4: LATER OF discloses the after side, exclusive", () => {
    expect(
      disclose(
        "VEST FROM LATER OF (DATE 2027-01-01, EVENT ipo) OVER 12 months EVERY 1 month",
      ),
    ).toEqual([
      {
        eventId: "ipo",
        through: "2027-01-01",
        direction: "after",
        inclusive: false,
      },
    ]);
  });

  it("AC5: the EVENT_NOT_YET_OCCURRED blocker carries the descriptor, not just `through`", () => {
    // The descriptor is minted where the AtomCondition is in hand, so it rides on the
    // pending blocker itself — not just on the post-derived assumption.
    const schedule = evaluateProgram(
      prog(
        "VEST FROM DATE 2025-01-01 AFTER EVENT ipo OVER 12 months EVERY 1 month",
      ),
      ctxInput({ grantDate: "2024-01-01", grantQuantity: 1200 }),
    );
    expect(findUnfired(schedule.resolution.pending, "ipo")).toEqual({
      through: "2025-01-01",
      direction: "after",
      inclusive: false,
    });
  });

  it("mixed-direction same event: gate-both-ways discloses two direction-correct records", () => {
    // One statement gates `ipo` BEFORE its start, another AFTER — same event, no
    // compound gate. Keying the collapse on the event id alone would drop one
    // direction; keying on (event, relation) keeps both, each pointing the right way.
    const dsl =
      "1/2 VEST FROM DATE 2026-01-01 BEFORE EVENT ipo OVER 12 months EVERY 1 month " +
      "PLUS 1/2 VEST FROM DATE 2025-01-01 AFTER EVENT ipo OVER 12 months EVERY 1 month";
    const out = disclose(dsl);
    expect(out).toContainEqual({
      eventId: "ipo",
      through: "2026-01-01",
      direction: "before",
      inclusive: false,
    });
    expect(out).toContainEqual({
      eventId: "ipo",
      through: "2025-01-01",
      direction: "after",
      inclusive: false,
    });
    expect(out).toHaveLength(2);
  });
});
