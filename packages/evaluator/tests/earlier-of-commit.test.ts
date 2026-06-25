// Issue #251 — EARLIER OF with a settled date arm commits to that floor in the
// closed-world `resolution` verdict (only), discloses the still-pending arm, and
// no longer freezes the grid. The interchange verdict stays firing-blind and never
// commits. These crystallize the issue's numbered acceptance criteria.

import { describe, it, expect } from "vitest";
import { CONTINGENT_START_SENTINEL } from "@vestlang/utils";
import type { AsOfContextInput, Blocker } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/evaluate";
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
      return { through: b.boundary?.through };
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
      {
        eventId: "ipo",
        through: "2024-06-01",
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
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
    // Firing-blind: a contingent-start template (start on the sentinel + the one
    // reserved `evt:start` recipe).
    if (blind.interchange.status !== "template")
      throw new Error("expected interchange template");
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

  it("resolution is a template with a placeable cliff and a correct projection, and discloses fda (#464)", () => {
    const schedule = evaluateProgram(
      prog(dsl),
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800, asOf: "2026-06-01" }),
    );
    if (schedule.resolution.status !== "template")
      throw new Error(
        `expected resolution template, got ${schedule.resolution.status}`,
      );
    // The grid is no longer frozen — it projects the full grant. Narrow to
    // {date, amount} up front so the shape checks below don't re-prove RESOLVED.
    const resolved = schedule.resolution.installments.flatMap((i) =>
      i.state === "RESOLVED" ? [{ date: i.date, amount: i.amount }] : [],
    );
    expect(resolved.reduce((n, i) => n + i.amount, 0)).toBe(4800);
    // The cliff lump (12/48 of 4800) folds on the +12mo floor 2026-01-01.
    const lump = resolved.find((i) => i.date === "2026-01-01");
    expect(lump?.amount).toBe(1200);
    // The 36 post-cliff months are 100 each — a mis-distribution that preserved
    // lump+total alone would slip past, so pin the shape too.
    const after = resolved.filter((i) => i.date > "2026-01-01");
    expect(after).toHaveLength(36);
    for (const i of after) expect(i.amount).toBe(100);

    // #464: the committed floor leans on fda staying absent through it — an earlier
    // firing would re-grid — so the cliff now discloses, mirroring the start case.
    expect(schedule.absenceAssumptions).toEqual([
      {
        eventId: "fda",
        through: "2026-01-01",
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
    ]);
    // The same disclosure rides in resolution.pending (#464 / correction #2).
    expect(findUnfired(schedule.resolution.pending, "fda")).toEqual({
      through: "2026-01-01",
    });
  });

  it("discharges when fda fires before the floor → no absence note, none in pending (#464)", () => {
    // fda @ 2025-07-01 is earlier than the +12mo floor, so EARLIER OF picks it and
    // the fold is all-settled (RESOLVED, not COMMITTED) — nothing to assume absent.
    const schedule = evaluateProgram(
      prog(dsl),
      ctx({
        grantDate: "2025-01-01",
        grantQuantity: 4800,
        asOf: "2026-06-01",
        events: { fda: "2025-07-01" },
      }),
    );
    expect(schedule.resolution.status).toBe("template");
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolution.pending, "fda")).toBeUndefined();
  });

  it("a no-lump EARLIER OF cliff (+0 months) lowers to NONE and stays silent (#464)", () => {
    // +0 months yields no pre-cliff lump, so the cliff lowers to NONE. Unlike the
    // start, a no-lump cliff is grid-invariant under an earlier firing (an earlier
    // floor still produces no lump, no re-grid), so there is genuinely nothing to
    // disclose — the carry deliberately lives only on the RESOLVED arm, not NONE.
    const noLump =
      "VEST OVER 48 months EVERY 1 month CLIFF EARLIER OF (+0 months, EVENT fda)";
    const schedule = evaluateProgram(
      prog(noLump),
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800, asOf: "2026-06-01" }),
    );
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolution.pending, "fda")).toBeUndefined();
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
      {
        eventId: "e",
        through: "2024-09-01",
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
    ]);
    expect(findUnfired(schedule.resolution.pending, "e")).toEqual({
      through: "2024-09-01",
    });
  });

  it("AC-2: dominated inner — `e` can't move the answer, so it is silent (#473)", () => {
    // EARLIER OF (DATE 2024-06-01, EVENT e) commits to 2024-06-01; the outer LATER OF
    // takes max(2024-06-01, 2024-09-01) = 2024-09-01, which the DATE arm pins. `e`
    // could only pull the inner floor *earlier*, which the later DATE arm already
    // swamps — so no firing of `e` can move the start. Under the materiality rule the
    // inner floor is not the strict max, so the fold settles RESOLVED (not COMMITTED)
    // and discloses nothing: no `e` assumption, none in pending, and no false
    // `grid-shift` consequence.
    const dsl =
      "VEST FROM LATER OF (EARLIER OF (DATE 2024-06-01, EVENT e), DATE 2024-09-01) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(schedule.resolution.runtime.startDate).toBe("2024-09-01");
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolution.pending, "e")).toBeUndefined();
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
      direction: "before",
      inclusive: false,
      consequence: "grid-shift",
    });
    expect(findUnfired(schedule.resolution.pending, "e")).toEqual({
      through: "2024-06-01",
    });
    expect(findUnfired(schedule.resolution.pending, "f")).toBeDefined();
  });

  // TIE (both arm orders) — the inner floor equals a sibling DATE arm, so it is not
  // the strict max and `e` can never move the `LATER OF` answer. `reduceBest` folds
  // with strict `lt`, so on a tie the first-written arm wins; gating on "the committed
  // arm won" alone would disclose or stay silent purely by arm order. The strict-max
  // gate removes that order dependence: both orders settle RESOLVED and stay silent.
  it.each([
    [
      "inner first",
      "VEST FROM LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-09-01) OVER 12 months EVERY 1 month",
    ],
    [
      "date first",
      "VEST FROM LATER OF (DATE 2024-09-01, EARLIER OF (DATE 2024-09-01, EVENT e)) OVER 12 months EVERY 1 month",
    ],
  ])("tie-guard (%s): equal floors → silent on `e`", (_label, dsl) => {
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(schedule.resolution.runtime.startDate).toBe("2024-09-01");
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolution.pending, "e")).toBeUndefined();
  });

  it("multi-committed — only the winning arm's event discloses; the dominated one is silent", () => {
    // LATER OF over two committed inner EARLIER OFs: the `e` arm commits to 2024-09-01,
    // the `f` arm to 2024-06-01. The outer max is 2024-09-01 (the `e` arm), the unique
    // strict max — so `e` is material and discloses, while `f`'s floor is swamped and
    // its assumption is dropped (the losing committed arm isn't harvested).
    const dsl =
      "VEST FROM LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), EARLIER OF (DATE 2024-06-01, EVENT f)) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(schedule.resolution.runtime.startDate).toBe("2024-09-01");
    expect(schedule.absenceAssumptions).toEqual([
      {
        eventId: "e",
        through: "2024-09-01",
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
    ]);
    expect(findUnfired(schedule.resolution.pending, "e")).toEqual({
      through: "2024-09-01",
    });
    expect(findUnfired(schedule.resolution.pending, "f")).toBeUndefined();
  });

  it("multi-committed in a PARTIAL LATER — winner discloses, dominated committed arm silent, pending arm rides", () => {
    // A pending bare-event arm `f` keeps the outer LATER OF open (Branch C). Among the
    // two settled committed arms the `e` arm (2024-09-01) strictly beats the `g` arm
    // (2024-06-01): `e` is the strict max of the settled set so it discloses, `g` is
    // dominated and dropped, and the still-pending `f` rides up alongside `e`.
    const dsl =
      "VEST FROM LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), EARLIER OF (DATE 2024-06-01, EVENT g), EVENT f) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    expect(schedule.absenceAssumptions).toContainEqual({
      eventId: "e",
      through: "2024-09-01",
      direction: "before",
      inclusive: false,
      consequence: "grid-shift",
    });
    expect(findUnfired(schedule.resolution.pending, "e")).toEqual({
      through: "2024-09-01",
    });
    expect(findUnfired(schedule.resolution.pending, "g")).toBeUndefined();
    expect(findUnfired(schedule.resolution.pending, "f")).toBeDefined();
  });

  it("fired inner event — the nested fold is RESOLVED (not COMMITTED), so nothing discloses", () => {
    // Grant 2024-01-01, 120 shares over 12 months / 1 month, but now `e` is FIRED at
    // 2024-05-01. The inner EARLIER OF resolves to the real firing (RESOLVED, not a
    // commit-on-absence), and the outer LATER OF takes max(2024-05-01, 2024-06-01) =
    // 2024-06-01 — both arms RESOLVED, no committed winner. This pins the fired-arm
    // branch of the gate: `isPickedCommitted(winner)` is false, so the harvest skips
    // and a fired event is never an absence assumption (AC-3).
    const dsl =
      "VEST FROM LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-06-01) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(
      prog(dsl),
      ctx({ events: { e: "2024-05-01" } }),
    );
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(schedule.resolution.runtime.startDate).toBe("2024-06-01");
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolution.pending, "e")).toBeUndefined();
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
      {
        eventId: "e",
        through: "2024-06-01",
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
    ]);
  });

  it("flattened same-selector EARLIER OF (EARLIER OF ..., DATE) discloses `e` once through 2024-06-01", () => {
    // Same-selector nesting flattens at compile time to a single 3-arm EARLIER_OF,
    // so it never hits a nested fold — and dedup keeps `e` to a single entry.
    const dsl =
      "VEST FROM EARLIER OF (EARLIER OF (DATE 2024-06-01, EVENT e), DATE 2024-09-01) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    expect(schedule.absenceAssumptions).toEqual([
      {
        eventId: "e",
        through: "2024-06-01",
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
    ]);
  });
});

// #363 AC-7 — the NESTED combinator in cliff position discloses on the SAME
// materiality rule as the start (#473). A `CLIFF LATER OF (EARLIER OF (...), DATE)`
// references an event, so it routes through `lowerEventCliff` (the inner EARLIER OF
// is the event side, lowered to an `event_condition`) — a different path than the
// top-level EARLIER OF cliff #464 carries. When the inner floor is the unique strict
// max of the outer `LATER OF`, a firing of its event would re-grid the cliff, so it
// is material: the cliff harvests the gated disclosure through the `LATER_OF →
// event_condition` lowering, exactly as the start surfaces it (#363 AC-1). When the
// inner floor is swamped (the dominated guard below), it stays silent.
describe("#363 AC-7 — nested combinator in cliff position discloses when material", () => {
  it("material: CLIFF LATER OF (EARLIER OF (DATE 09-01, EVENT e), DATE 06-01) discloses `e`", () => {
    // Grant 2024-01-01, 4800 shares over 48 months / 1 month. The inner EARLIER OF
    // commits to its 2024-09-01 floor; the outer LATER OF takes max(09-01, 06-01) =
    // 09-01, the unique strict max — so `e` is material and discloses through it.
    const dsl =
      "VEST OVER 48 months EVERY 1 month CLIFF LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-06-01)";
    const schedule = evaluateProgram(prog(dsl), ctx({ grantQuantity: 4800 }));
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(schedule.absenceAssumptions).toEqual([
      {
        eventId: "e",
        through: "2024-09-01",
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
    ]);
    expect(findUnfired(schedule.resolution.pending, "e")).toEqual({
      through: "2024-09-01",
    });
  });

  it("dominated: CLIFF LATER OF (EARLIER OF (DATE 06-01, EVENT e), DATE 09-01) stays silent", () => {
    // Same fixture, swapped dates. The inner floor 2024-06-01 is swamped by the DATE
    // arm 2024-09-01, so `e` can't move the cliff — the harvest is materiality-gated,
    // not unconditional, so nothing discloses.
    const dsl =
      "VEST OVER 48 months EVERY 1 month CLIFF LATER OF (EARLIER OF (DATE 2024-06-01, EVENT e), DATE 2024-09-01)";
    const schedule = evaluateProgram(prog(dsl), ctx({ grantQuantity: 4800 }));
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolution.pending, "e")).toBeUndefined();
  });

  it("tie: CLIFF LATER OF (EARLIER OF (DATE 09-01, EVENT e), DATE 09-01) stays silent", () => {
    // The inner floor TIES the DATE arm at 2024-09-01. Here the firing IS defined at
    // the tied floor, so silence rests on `winnerIsStrictMax` returning false on the
    // tie — the equal DATE arm pins the max, so no firing of `e` can move it.
    const dsl =
      "VEST OVER 48 months EVERY 1 month CLIFF LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-09-01)";
    const schedule = evaluateProgram(prog(dsl), ctx({ grantQuantity: 4800 }));
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolution.pending, "e")).toBeUndefined();
  });

  it("fired inner event: CLIFF LATER OF (EARLIER OF (DATE 09-01, EVENT e), DATE 06-01) with `e` fired stays silent", () => {
    // Grant 2024-01-01, 4800 shares over 48 months / 1 month, the material ordering,
    // but `e` is FIRED at 2024-05-01. The inner EARLIER OF resolves to the real firing
    // (RESOLVED), so the whole-expression fold is RESOLVED, not COMMITTED — pinning the
    // fired-arm branch of `committedCliffDisclosures`, which returns `[]`. A fired event
    // is no absence assumption (AC-3).
    const dsl =
      "VEST OVER 48 months EVERY 1 month CLIFF LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-06-01)";
    const schedule = evaluateProgram(
      prog(dsl),
      ctx({ grantQuantity: 4800, events: { e: "2024-05-01" } }),
    );
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolution.pending, "e")).toBeUndefined();
  });
});

// #473 — the deferred (anchor-free) cliff path. A pending event start (`FROM EVENT g`,
// `g` unfired) routes the cliff through `lowerDeferredCliff`. Its event side is
// firing-blind, but the committed inner `EARLIER OF` still folds to a date the gate
// can compare, so the same materiality rule decides disclosure. The start's own
// `EVENT_NOT_YET_OCCURRED(g)` rides in `pending` too (a bare wait, no boundary, so it
// is not an absence assumption), so these assert on `e` specifically.
describe("#473 — deferred cliff harvests the gated disclosure", () => {
  // Grant 2024-01-01, 4800 shares, start waits on the unfired event `g`.
  const deferredCtx = ctx({ grantQuantity: 4800, events: {} });

  it("material: FROM EVENT g … CLIFF LATER OF (EARLIER OF (DATE 09-01, EVENT e), DATE 06-01) discloses `e`", () => {
    const dsl =
      "VEST FROM EVENT g OVER 48 months EVERY 1 month CLIFF LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-06-01)";
    const schedule = evaluateProgram(prog(dsl), deferredCtx);
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    // The inner floor 2024-09-01 is the unique strict max, so `e` is material even
    // though the start firing is unknown.
    expect(schedule.absenceAssumptions).toContainEqual({
      eventId: "e",
      through: "2024-09-01",
      direction: "before",
      inclusive: false,
      consequence: "grid-shift",
    });
    expect(findUnfired(schedule.resolution.pending, "e")).toEqual({
      through: "2024-09-01",
    });
  });

  it("dominated: FROM EVENT g … CLIFF LATER OF (EARLIER OF (DATE 06-01, EVENT e), DATE 09-01) stays silent on `e`", () => {
    const dsl =
      "VEST FROM EVENT g OVER 48 months EVERY 1 month CLIFF LATER OF (EARLIER OF (DATE 2024-06-01, EVENT e), DATE 2024-09-01)";
    const schedule = evaluateProgram(prog(dsl), deferredCtx);
    if (schedule.resolution.status !== "template")
      throw new Error(`expected template, got ${schedule.resolution.status}`);
    // The inner floor is swamped, so `e` is immaterial — no assumption for it. (The
    // start's own `g` wait is still present, unrelated.)
    expect(
      schedule.absenceAssumptions.find((a) => a.eventId === "e"),
    ).toBeUndefined();
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
      direction: "before",
      inclusive: false,
      consequence: "grid-shift",
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
      {
        eventId: "ipo",
        through: "2024-06-01",
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
    ]);
  });
});
