// Issue #251 — EARLIER OF with a settled date arm commits to that floor in the
// closed-world `resolution` verdict (only), discloses the still-pending arm, and
// no longer freezes the grid. The interchange verdict stays firing-blind and never
// commits. These crystallize the issue's numbered acceptance criteria.

import { describe, it, expect } from "vitest";
import { CONTINGENT_START_SENTINEL } from "@vestlang/core";
import type { AsOfContextInput, Blocker } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/orchestrate";
import { evaluateProgramAsOf } from "../src/asof";

const prog = (dsl: string) => normalizeProgram(parse(dsl));

const ctx = (overrides: Partial<AsOfContextInput> = {}): AsOfContextInput => ({
  grantDate: "2024-01-01",
  events: {},
  grantQuantity: 120,
  asOf: "2026-06-01",
  ...overrides,
});

// Recursively search a blocker tree for the unfired-event leaf and its `through`.
const findUnfired = (
  bs: Blocker[],
  event: string,
): { through?: string } | undefined => {
  for (const b of bs) {
    if (b.type === "EVENT_NOT_YET_OCCURRED" && b.event === event)
      return { through: b.through };
    if (b.type === "UNRESOLVED_SELECTOR" || b.type === "IMPOSSIBLE_SELECTOR") {
      const hit = findUnfired(b.blockers as Blocker[], event);
      if (hit) return hit;
    }
  }
  return undefined;
};

const HEADLINE =
  "VEST FROM EARLIER OF (DATE 2024-06-01, EVENT ipo) OVER 12 months EVERY 1 month";

describe("#251 AC1 — headline repro: commits to the date floor, discloses ipo", () => {
  it("as_of 2026-06-01, ipo unfired → 120 vested, 0 unresolved, ipo disclosed through 2024-06-01", () => {
    const asof = evaluateProgramAsOf(prog(HEADLINE), ctx());
    const vested = asof.vested.reduce((n, t) => n + t.amount, 0);
    expect(vested).toBe(120);
    expect(asof.unresolved).toBe(0);

    const schedule = evaluateProgram(prog(HEADLINE), ctx());
    expect(schedule.absenceAssumptions).toEqual([
      { eventId: "ipo", through: "2024-06-01" },
    ]);
    // The same disclosure appears in resolution.pending.
    expect(findUnfired(schedule.resolution.pending, "ipo")).toEqual({
      through: "2024-06-01",
    });
  });
});

describe("#251 AC2 — never-fires no longer freezes", () => {
  it("ipo never fired, as_of past the date arm → fully vested", () => {
    const asof = evaluateProgramAsOf(
      prog(HEADLINE),
      ctx({ asOf: "2025-06-01" }),
    );
    const vested = asof.vested.reduce((n, t) => n + t.amount, 0);
    expect(vested).toBe(120);
    expect(asof.unresolved).toBe(0);
  });
});

describe("#251 AC3 — floor property", () => {
  // The committed projection: the 12 monthly dates off 2024-06-01.
  const committedDates = () =>
    evaluateProgram(prog(HEADLINE), ctx())
      .resolution.installments.filter((i) => i.state === "RESOLVED")
      .map((i) => (i.state === "RESOLVED" ? i.date : ""));

  it("ipo earlier than the date arm ⇒ start moves strictly earlier (firing honored, not floored)", () => {
    // The committed projection is anchored at the 2024-06-01 date arm.
    const committedFirst = committedDates()[0];
    // ipo on 2024-03-01 — earlier than the date arm — so EARLIER OF now picks ipo
    // and the whole grid shifts earlier. Asserting the dates actually move (not just
    // the as-of count) is what distinguishes "firing honored" from "dropped to the
    // date floor": vested ≥ floor holds either way, but only an honored firing
    // shifts the tranche dates back.
    const earlyDates = evaluateProgram(
      prog(HEADLINE),
      ctx({ events: { ipo: "2024-03-01" } }),
    )
      .resolution.installments.filter((i) => i.state === "RESOLVED")
      .map((i) => (i.state === "RESOLVED" ? i.date : ""));
    expect(earlyDates[0] < committedFirst).toBe(true);

    // And the as-of vested count is never below the committed floor.
    const committed = evaluateProgramAsOf(prog(HEADLINE), ctx()).vested.reduce(
      (n, t) => n + t.amount,
      0,
    );
    const early = evaluateProgramAsOf(
      prog(HEADLINE),
      ctx({ events: { ipo: "2024-03-01" } }),
    ).vested.reduce((n, t) => n + t.amount, 0);
    expect(early).toBeGreaterThanOrEqual(committed);
  });

  it("ipo later than the date arm ⇒ the date arm still wins (same dates as the commit)", () => {
    const baseline = committedDates();
    const later = evaluateProgram(
      prog(HEADLINE),
      ctx({ events: { ipo: "2025-01-01" } }),
    )
      .resolution.installments.filter((i) => i.state === "RESOLVED")
      .map((i) => (i.state === "RESOLVED" ? i.date : ""));
    expect(later).toEqual(baseline);
  });
});

describe("#251 AC4 — all-pending lower edge (no spurious commit)", () => {
  it("EARLIER OF (EVENT a, EVENT b), both unfired → resolution stays pending", () => {
    const dsl =
      "VEST FROM EARLIER OF (EVENT a, EVENT b) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    // No resolved arm to commit to: it does not commit, so nothing dated vests.
    const dated = schedule.resolution.installments.filter(
      (i) => i.state === "RESOLVED",
    );
    expect(dated).toHaveLength(0);
    expect(schedule.resolution.pending.length).toBeGreaterThan(0);
    // No absence assumption either — there's no committed date to stamp through.
    expect(schedule.absenceAssumptions).toEqual([]);
  });
});

describe("#251 AC5 — interchange unchanged for the start case", () => {
  it("the headline's interchange is still a contingent-start template, invariant to ipo", () => {
    const blind = evaluateProgram(prog(HEADLINE), ctx());
    const fired = evaluateProgram(
      prog(HEADLINE),
      ctx({ events: { ipo: "2024-03-01" } }),
    );
    // Firing-blind: a contingent-start template (DATE base on the sentinel + the
    // one reserved `evt:start` recipe).
    if (blind.interchange.status !== "template")
      throw new Error("expected interchange template");
    expect(blind.interchange.template.statements[0].vesting_base).toEqual({
      type: "DATE",
    });
    expect(blind.interchange.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(blind.interchange.sourceMap)).toEqual(["evt:start"]);
    // Invariant to whether ipo fired.
    expect(fired.interchange).toEqual(blind.interchange);
  });
});

describe("#251 AC6 — EARLIER OF cliff (the worse form) resolves to a committed floor", () => {
  // CLIFF EARLIER OF (+12 months, EVENT fda): the +12mo arm is the floor.
  const dsl =
    "VEST OVER 48 months EVERY 1 month CLIFF EARLIER OF (+12 months, EVENT fda)";

  it("resolution is a template with a placeable cliff and a correct projection (silent)", () => {
    const schedule = evaluateProgram(
      prog(dsl),
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800, asOf: "2026-06-01" }),
    );
    if (schedule.resolution.status !== "template")
      throw new Error(
        `expected resolution template, got ${schedule.resolution.status}`,
      );
    // The cliff lands at the committed floor (start + 12 months).
    expect(schedule.cliffDate).toBe("2026-01-01");
    // The grid is no longer frozen — it projects the full grant.
    const total = schedule.resolution.installments
      .filter((i) => i.state === "RESOLVED")
      .reduce((n, i) => n + (i.state === "RESOLVED" ? i.amount : 0), 0);
    expect(total).toBe(4800);
    // Silent per #325: a resolved cliff has no absence-note slot.
    expect(schedule.absenceAssumptions).toEqual([]);
  });
});

describe("#251 AC7 — persist gates on interchange (the cliff stays unrepresentable)", () => {
  it("the EARLIER OF cliff resolves to template but its interchange is unrepresentable", () => {
    const dsl =
      "VEST OVER 48 months EVERY 1 month CLIFF EARLIER OF (+12 months, EVENT fda)";
    const schedule = evaluateProgram(
      prog(dsl),
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800 }),
    );
    expect(schedule.resolution.status).toBe("template");
    // An EARLIER OF cliff has no storable form (the event arm can't be a duration
    // cliff), so persist (which gates on interchange) refuses it — covered E2E in
    // the pipeline/mcp persist suites; here we pin the verdict divergence.
    expect(schedule.interchange.status).toBe("unrepresentable");
  });
});

describe("#251 AC14 — nested commit settles (outer fold consumes the committed inner pick)", () => {
  it("EARLIER OF (EARLIER OF (DATE d1, EVENT e), DATE d2) resolves rather than freezing", () => {
    const dsl =
      "VEST FROM EARLIER OF (EARLIER OF (DATE 2024-06-01, EVENT e), DATE 2024-09-01) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    // The inner EARLIER OF commits to 2024-06-01 (its floor); the outer EARLIER OF
    // takes the earlier of {2024-06-01, 2024-09-01} = 2024-06-01.
    expect(schedule.resolution.runtime.startDate).toBe("2024-06-01");
  });

  it("LATER OF (EARLIER OF (DATE d, EVENT e), DATE d2) resolves on the committed inner floor", () => {
    // Inner EARLIER OF commits to 2024-06-01; the outer LATER OF takes the later of
    // {2024-06-01, 2024-09-01} = 2024-09-01 (the inner committed pick is a settled
    // floor the outer fold consumes, not a pending arm that would re-freeze).
    const dsl =
      "VEST FROM LATER OF (EARLIER OF (DATE 2024-06-01, EVENT e), DATE 2024-09-01) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(schedule.resolution.runtime.startDate).toBe("2024-09-01");
  });
});

// #363 — a committed inner pick consumed by an outer combinator of the OTHER type
// keeps disclosing its assumed-absent siblings. The inner EARLIER OF commits to its
// floor and leans on `e` staying absent; the outer LATER OF reads only the inner's
// floor date and used to drop that assumption. The fix harvests the committed arm's
// disclosures one level up (re-stamped through the outer fold's date, Decision 2),
// so the assumption survives to `absenceAssumptions` and `resolution.pending`.
describe("#363 — committed-pick disclosures carry up through an outer fold", () => {
  it("AC-1: material outer LATER OF — start moves with the event, `e` disclosed through the outer date", () => {
    // EARLIER OF (DATE 2024-09-01, EVENT e) commits to its 2024-09-01 floor; the
    // outer LATER OF takes max(2024-09-01, 2024-06-01) = 2024-09-01. A firing of `e`
    // ≤ 2024-09-01 would move the inner floor earlier, so `e` is material here — and
    // it is disclosed `through` the resolved start.
    const dsl =
      "VEST FROM LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-06-01) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(schedule.resolution.runtime.startDate).toBe("2024-09-01");
    expect(schedule.absenceAssumptions).toEqual([
      { eventId: "e", through: "2024-09-01" },
    ]);
    expect(findUnfired(schedule.resolution.pending, "e")).toEqual({
      through: "2024-09-01",
    });
  });

  it("AC-2: vacuous-but-disclosed (issue headline) — `e` can't move the answer, disclosed anyway through the outer date", () => {
    // EARLIER OF (DATE 2024-06-01, EVENT e) commits to 2024-06-01; the outer LATER OF
    // takes max(2024-06-01, 2024-09-01) = 2024-09-01. `e` could only pull the inner
    // floor earlier, which the outer date already swamps — so `e` is immaterial to
    // the final date. Per Decision 1 it is disclosed anyway, stamped `through` the
    // outer fold's 2024-09-01 (Decision 2), not the inner 2024-06-01.
    const dsl =
      "VEST FROM LATER OF (EARLIER OF (DATE 2024-06-01, EVENT e), DATE 2024-09-01) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(schedule.resolution.runtime.startDate).toBe("2024-09-01");
    expect(schedule.absenceAssumptions).toEqual([
      { eventId: "e", through: "2024-09-01" },
    ]);
  });

  it("AC-5: partial LATER OF carries the inner disclosure alongside its own pending arm", () => {
    // EARLIER OF (DATE 2024-06-01, EVENT e) commits to 2024-06-01; the outer LATER OF
    // has a still-pending bare-event arm `f`, so it stays open (the partial branch,
    // which already routes through collectBlockers). `e`'s assumption must ride
    // alongside `f` rather than vanishing — this exercises the collectBlockers half
    // of the fix.
    const dsl =
      "VEST FROM LATER OF (EARLIER OF (DATE 2024-06-01, EVENT e), EVENT f) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    // Both the committed inner's `e` and the pending outer's `f` surface.
    expect(schedule.absenceAssumptions).toContainEqual({
      eventId: "e",
      through: "2024-06-01",
    });
    expect(findUnfired(schedule.resolution.pending, "e")).toEqual({
      through: "2024-06-01",
    });
    expect(findUnfired(schedule.resolution.pending, "f")).toBeDefined();
  });
});

// #363 AC-6 — the single-level and same-selector-flattened cases must still
// disclose `e` exactly once. "Exactly once" is asserted against the deduped
// `absenceAssumptions` array (dedup lives in collectAbsences); the raw blocker tree
// isn't deduped, so a count there wouldn't be a meaningful guard.
describe("#363 AC-6 — no regression on single-level / flattened cases", () => {
  it("bare committed EARLIER OF discloses `e` once through 2024-06-01", () => {
    const dsl =
      "VEST FROM EARLIER OF (DATE 2024-06-01, EVENT e) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    expect(schedule.absenceAssumptions).toEqual([
      { eventId: "e", through: "2024-06-01" },
    ]);
  });

  it("flattened same-selector EARLIER OF (EARLIER OF ..., DATE) discloses `e` once through 2024-06-01", () => {
    // Same-selector nesting flattens at compile time to a single 3-arm EARLIER_OF,
    // so it never hits a nested fold — and dedup keeps `e` to a single entry.
    const dsl =
      "VEST FROM EARLIER OF (EARLIER OF (DATE 2024-06-01, EVENT e), DATE 2024-09-01) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    expect(schedule.absenceAssumptions).toEqual([
      { eventId: "e", through: "2024-06-01" },
    ]);
  });
});

// #363 AC-7 — the cliff carve-out is unaffected. A nested combinator IS expressible
// in cliff position at the DSL surface (CLIFF LATER OF (EARLIER OF (...), DATE)
// parses and evaluates), so the all-settled branch now yields a COMMITTED cliff
// node too. But cliff.ts reads the date via pickedDate and deliberately discards
// cliff disclosures (the #251/AC6 carve-out: an EARLIER_OF cliff carries no absence
// note). So the SAME nested combinator that surfaces `e` in start position (AC-1)
// must surface nothing in cliff position. This locks that the start-position change
// does not leak disclosures into cliffs.
describe("#363 AC-7 — nested combinator in cliff position discloses nothing", () => {
  it("CLIFF LATER OF (EARLIER OF (DATE, EVENT e), DATE) places its cliff but discloses no `e`", () => {
    const dsl =
      "VEST OVER 48 months EVERY 1 month CLIFF LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-06-01)";
    const schedule = evaluateProgram(prog(dsl), ctx({ grantQuantity: 4800 }));
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    // The cliff lands at the committed-then-folded floor (max of the two date arms).
    expect(schedule.cliffDate).toBe("2024-09-01");
    // Carve-out: no absence note for `e`, on either surface.
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolution.pending, "e")).toBeUndefined();
  });
});

describe("#251 AC16 — LATER OF unregressed", () => {
  it("LATER OF (DATE future, EVENT ipo), ipo unfired → still pending (upper bound, no commit)", () => {
    const dsl =
      "VEST FROM LATER OF (DATE 2024-06-01, EVENT ipo) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    // LATER OF's resolved arm is an upper bound, so it must NOT commit to a date —
    // it stays a synthetic-event template waiting on ipo (no dated installments).
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    const dated = schedule.resolution.installments.filter(
      (i) => i.state === "RESOLVED",
    );
    expect(dated).toHaveLength(0);
    expect(findUnfired(schedule.resolution.pending, "ipo")).toBeDefined();
  });
});

describe("#251 — a committed disclosure survives the unresolved routing arm", () => {
  // A committed EARLIER OF rides into whichever arm the program routes to with its
  // pending siblings' disclosures attached. The events and template arms surface
  // them; the unresolved arm is the third path and must too. Here portion 2's
  // partial LATER OF cliff stays unresolved (waiting on `x`), which forces the
  // whole program down the unresolved arm — and portion 1's committed `e`
  // disclosure must not be lost on the way.
  const dsl =
    "1/2 VEST FROM EARLIER OF (DATE 2024-06-01, EVENT e) OVER 12 months EVERY 1 month " +
    "PLUS 1/2 VEST FROM DATE 2024-01-01 OVER 12 months EVERY 1 month CLIFF LATER OF (+6 months, EVENT x)";

  it("discloses `e` through the commit date even though `x` routes it through the unresolved arm", () => {
    const schedule = evaluateProgram(prog(dsl), ctx());
    // Portion 1's EARLIER OF committed to its 2024-06-01 floor, so `e` is assumed
    // absent through that date.
    expect(findUnfired(schedule.resolution.pending, "e")).toEqual({
      through: "2024-06-01",
    });
    expect(schedule.absenceAssumptions).toContainEqual({
      eventId: "e",
      through: "2024-06-01",
    });
    // Sanity: portion 2's own pending cliff event is disclosed too — `e` rides
    // alongside it, it doesn't displace it.
    expect(findUnfired(schedule.resolution.pending, "x")).toBeDefined();
  });
});

describe("#251 AC17 — schedule-level EARLIER START OF behaves as the node-level case", () => {
  it("EARLIER START OF commits to the date floor and discloses ipo", () => {
    const dsl =
      "VEST EARLIER START OF (FROM DATE 2024-06-01 OVER 12 months EVERY 1 month, FROM EVENT ipo OVER 12 months EVERY 1 month)";
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(schedule.resolution.runtime.startDate).toBe("2024-06-01");
    expect(schedule.absenceAssumptions).toEqual([
      { eventId: "ipo", through: "2024-06-01" },
    ]);
  });
});
