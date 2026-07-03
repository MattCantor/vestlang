// Issue #251 — EARLIER OF with a settled date arm commits to that floor in the
// closed-world `resolvesTo` verdict (only), discloses the still-pending arm, and
// no longer freezes the grid. The storable verdict stays firing-blind and never
// commits. These crystallize the issue's numbered acceptance criteria.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
    // The same disclosure appears in resolvesTo.pending.
    expect(findUnfired(schedule.resolvesTo.pending, "ipo")).toEqual({
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
      .resolvesTo.installments.filter((i) => i.state === "RESOLVED")
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
      .resolvesTo.installments.filter((i) => i.state === "RESOLVED")
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
      .resolvesTo.installments.filter((i) => i.state === "RESOLVED")
      .map((i) => (i.state === "RESOLVED" ? i.date : ""));
    expect(later).toEqual(baseline);
  });
});

describe("#251 AC4 — all-pending lower edge (no spurious commit)", () => {
  it("EARLIER OF (EVENT a, EVENT b), both unfired → resolvesTo stays pending", () => {
    const dsl =
      "VEST FROM EARLIER OF (EVENT a, EVENT b) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    // No resolved arm to commit to: it does not commit, so nothing dated vests.
    const dated = schedule.resolvesTo.installments.filter(
      (i) => i.state === "RESOLVED",
    );
    expect(dated).toHaveLength(0);
    expect(schedule.resolvesTo.pending.length).toBeGreaterThan(0);
    // No absence assumption either — there's no committed date to stamp through.
    expect(schedule.absenceAssumptions).toEqual([]);
  });
});

describe("#251 AC5 — storable unchanged for the start case", () => {
  it("the headline's storable is still a contingent-start template, invariant to ipo", () => {
    const blind = evaluateProgram(prog(HEADLINE), ctx());
    const fired = evaluateProgram(
      prog(HEADLINE),
      ctx({ events: { ipo: "2024-03-01" } }),
    );
    // Firing-blind: a contingent-start template (start on the sentinel + the one
    // reserved `evt:start` recipe).
    if (blind.storable.status !== "template")
      throw new Error("expected storable template");
    expect(blind.storable.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(blind.storable.sourceMap)).toEqual(["evt:start"]);
    // Invariant to whether ipo fired.
    expect(fired.storable).toEqual(blind.storable);
  });
});

describe("#251 AC6 — EARLIER OF cliff (the worse form) resolves to a committed floor", () => {
  // CLIFF EARLIER OF (+12 months, EVENT fda): the +12mo arm is the floor.
  const dsl =
    "VEST OVER 48 months EVERY 1 month CLIFF EARLIER OF (+12 months, EVENT fda)";

  it("resolvesTo is a template with a placeable cliff and a correct projection, and discloses fda (#464)", () => {
    const schedule = evaluateProgram(
      prog(dsl),
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800, asOf: "2026-06-01" }),
    );
    if (schedule.resolvesTo.status !== "template")
      throw new Error(
        `expected resolvesTo template, got ${schedule.resolvesTo.status}`,
      );
    // The grid is no longer frozen — it projects the full grant. Narrow to
    // {date, amount} up front so the shape checks below don't re-prove RESOLVED.
    const resolved = schedule.resolvesTo.installments.flatMap((i) =>
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
    // The same disclosure rides in resolvesTo.pending (#464 / correction #2).
    expect(findUnfired(schedule.resolvesTo.pending, "fda")).toEqual({
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
    expect(schedule.resolvesTo.status).toBe("template");
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolvesTo.pending, "fda")).toBeUndefined();
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
    expect(findUnfired(schedule.resolvesTo.pending, "fda")).toBeUndefined();
  });
});

describe("#251 AC7 — persist gates on storable (the cliff stays unrepresentable)", () => {
  it("the EARLIER OF cliff resolves to template but its storable is unrepresentable", () => {
    const dsl =
      "VEST OVER 48 months EVERY 1 month CLIFF EARLIER OF (+12 months, EVENT fda)";
    const schedule = evaluateProgram(
      prog(dsl),
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800 }),
    );
    expect(schedule.resolvesTo.status).toBe("template");
    // An EARLIER OF cliff has no storable form (the event arm can't be a duration
    // cliff), so persist (which gates on storable) refuses it — covered E2E in
    // the pipeline/mcp persist suites; here we pin the verdict divergence.
    expect(schedule.storable.status).toBe("unrepresentable");
  });
});

describe("#251 AC14 — nested commit settles (outer fold consumes the committed inner pick)", () => {
  it("EARLIER OF (EARLIER OF (DATE d1, EVENT e), DATE d2) resolves rather than freezing", () => {
    const dsl =
      "VEST FROM EARLIER OF (EARLIER OF (DATE 2024-06-01, EVENT e), DATE 2024-09-01) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    // The inner EARLIER OF commits to 2024-06-01 (its floor); the outer EARLIER OF
    // takes the earlier of {2024-06-01, 2024-09-01} = 2024-06-01.
    expect(schedule.resolvesTo.runtime.startDate).toBe("2024-06-01");
  });

  it("LATER OF (EARLIER OF (DATE d, EVENT e), DATE d2) resolves on the committed inner floor", () => {
    // Inner EARLIER OF commits to 2024-06-01; the outer LATER OF takes the later of
    // {2024-06-01, 2024-09-01} = 2024-09-01 (the inner committed pick is a settled
    // floor the outer fold consumes, not a pending arm that would re-freeze).
    const dsl =
      "VEST FROM LATER OF (EARLIER OF (DATE 2024-06-01, EVENT e), DATE 2024-09-01) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    expect(schedule.resolvesTo.runtime.startDate).toBe("2024-09-01");
  });
});

// #363 — a committed inner pick consumed by an outer combinator of the OTHER type
// keeps disclosing its assumed-absent siblings. The inner EARLIER OF commits to its
// floor and leans on `e` staying absent; the outer LATER OF reads only the inner's
// floor date and used to drop that assumption. The fix harvests the committed arm's
// disclosures one level up (re-stamped through the outer fold's date, Decision 2),
// so the assumption survives to `absenceAssumptions` and `resolvesTo.pending`.
describe("#363 — committed-pick disclosures carry up through an outer fold", () => {
  it("AC-1: material outer LATER OF — start moves with the event, `e` disclosed through the outer date", () => {
    // EARLIER OF (DATE 2024-09-01, EVENT e) commits to its 2024-09-01 floor; the
    // outer LATER OF takes max(2024-09-01, 2024-06-01) = 2024-09-01. A firing of `e`
    // ≤ 2024-09-01 would move the inner floor earlier, so `e` is material here — and
    // it is disclosed `through` the resolved start.
    const dsl =
      "VEST FROM LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-06-01) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    expect(schedule.resolvesTo.runtime.startDate).toBe("2024-09-01");
    expect(schedule.absenceAssumptions).toEqual([
      {
        eventId: "e",
        through: "2024-09-01",
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
    ]);
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toEqual({
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
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    expect(schedule.resolvesTo.runtime.startDate).toBe("2024-09-01");
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toBeUndefined();
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
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toEqual({
      through: "2024-06-01",
    });
    expect(findUnfired(schedule.resolvesTo.pending, "f")).toBeDefined();
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
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    expect(schedule.resolvesTo.runtime.startDate).toBe("2024-09-01");
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toBeUndefined();
  });

  it("multi-committed — only the winning arm's event discloses; the dominated one is silent", () => {
    // LATER OF over two committed inner EARLIER OFs: the `e` arm commits to 2024-09-01,
    // the `f` arm to 2024-06-01. The outer max is 2024-09-01 (the `e` arm), the unique
    // strict max — so `e` is material and discloses, while `f`'s floor is swamped and
    // its assumption is dropped (the losing committed arm isn't harvested).
    const dsl =
      "VEST FROM LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), EARLIER OF (DATE 2024-06-01, EVENT f)) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    expect(schedule.resolvesTo.runtime.startDate).toBe("2024-09-01");
    expect(schedule.absenceAssumptions).toEqual([
      {
        eventId: "e",
        through: "2024-09-01",
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
    ]);
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toEqual({
      through: "2024-09-01",
    });
    expect(findUnfired(schedule.resolvesTo.pending, "f")).toBeUndefined();
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
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toEqual({
      through: "2024-09-01",
    });
    expect(findUnfired(schedule.resolvesTo.pending, "g")).toBeUndefined();
    expect(findUnfired(schedule.resolvesTo.pending, "f")).toBeDefined();
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
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    expect(schedule.resolvesTo.runtime.startDate).toBe("2024-06-01");
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toBeUndefined();
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
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    expect(schedule.absenceAssumptions).toEqual([
      {
        eventId: "e",
        through: "2024-09-01",
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
    ]);
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toEqual({
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
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toBeUndefined();
  });

  it("tie: CLIFF LATER OF (EARLIER OF (DATE 09-01, EVENT e), DATE 09-01) stays silent", () => {
    // The inner floor TIES the DATE arm at 2024-09-01. Here the firing IS defined at
    // the tied floor, so silence rests on `winnerIsStrictMax` returning false on the
    // tie — the equal DATE arm pins the max, so no firing of `e` can move it.
    const dsl =
      "VEST OVER 48 months EVERY 1 month CLIFF LATER OF (EARLIER OF (DATE 2024-09-01, EVENT e), DATE 2024-09-01)";
    const schedule = evaluateProgram(prog(dsl), ctx({ grantQuantity: 4800 }));
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toBeUndefined();
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
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    expect(schedule.absenceAssumptions).toEqual([]);
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toBeUndefined();
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
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    // The inner floor 2024-09-01 is the unique strict max, so `e` is material even
    // though the start firing is unknown.
    expect(schedule.absenceAssumptions).toContainEqual({
      eventId: "e",
      through: "2024-09-01",
      direction: "before",
      inclusive: false,
      consequence: "grid-shift",
    });
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toEqual({
      through: "2024-09-01",
    });
  });

  it("dominated: FROM EVENT g … CLIFF LATER OF (EARLIER OF (DATE 06-01, EVENT e), DATE 09-01) stays silent on `e`", () => {
    const dsl =
      "VEST FROM EVENT g OVER 48 months EVERY 1 month CLIFF LATER OF (EARLIER OF (DATE 2024-06-01, EVENT e), DATE 2024-09-01)";
    const schedule = evaluateProgram(prog(dsl), deferredCtx);
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    // The inner floor is swamped, so `e` is immaterial — no assumption for it. (The
    // start's own `g` wait is still present, unrelated.)
    expect(
      schedule.absenceAssumptions.find((a) => a.eventId === "e"),
    ).toBeUndefined();
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toBeUndefined();
  });
});

// A top-level EARLIER OF cliff on a deferred (anchor-free) start. A pending start —
// a bare event (`FROM EVENT g`) or a combinator — routes the cliff through
// `lowerDeferredCliff`'s final fall-through: an EARLIER OF is acceleration, so it
// never decomposes to an event_condition, and a combinator has no derivable relative
// duration. Even without the start date, an absolute DATE arm folds to a committed
// floor with the unfired EVENT arm as a pending sibling; that floor leans on the event
// staying absent, so it discloses exactly as the anchored (dated-start) twin does. These pin
// the disclosure, its discharge, the two cells that stay silent, and the self-limit.
describe("deferred top-level EARLIER OF cliff discloses its committed floor", () => {
  const deferred = (overrides: Partial<AsOfContextInput> = {}) =>
    ctx({
      grantDate: "2025-01-01",
      grantQuantity: 4800,
      events: {},
      ...overrides,
    });

  it("discloses the committed floor's unfired event through the floor date", () => {
    const dsl =
      "VEST FROM EVENT g OVER 48 months EVERY 1 month CLIFF EARLIER OF (DATE 2026-01-01, EVENT e)";
    const schedule = evaluateProgram(prog(dsl), deferred());
    expect(schedule.resolvesTo.status).toBe("unresolved");
    // The 2026-01-01 floor leans on `e` staying absent — an earlier firing re-grids
    // the cliff — so `e` is disclosed through it. The start's own `g` wait is a bare,
    // boundary-less blocker, so it is not an absence assumption.
    expect(schedule.absenceAssumptions).toContainEqual({
      eventId: "e",
      through: "2026-01-01",
      direction: "before",
      inclusive: false,
      consequence: "grid-shift",
    });
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toEqual({
      through: "2026-01-01",
    });
    expect(
      schedule.absenceAssumptions.find((a) => a.eventId === "g"),
    ).toBeUndefined();
  });

  it("discloses the same floor under a combinator (synthetic-event) start", () => {
    // The harvest sits at a fall-through every deferred-start shape reaches, so a
    // combinator start discloses the same committed-floor event as a bare-event start:
    // the cliff floor is the same absolute date regardless of start shape.
    const dsl =
      "VEST FROM EARLIER OF (EVENT a, EVENT b) OVER 48 months EVERY 1 month CLIFF EARLIER OF (DATE 2026-01-01, EVENT e)";
    const schedule = evaluateProgram(prog(dsl), deferred());
    expect(schedule.resolvesTo.status).toBe("unresolved");
    expect(schedule.absenceAssumptions).toContainEqual({
      eventId: "e",
      through: "2026-01-01",
      direction: "before",
      inclusive: false,
      consequence: "grid-shift",
    });
  });

  it("does not disclose a floor event that has already fired", () => {
    // `e` fired before the DATE floor, so the EARLIER OF fold reads the real firing
    // (RESOLVED, not COMMITTED): the harvest is empty and nothing is disclosed for `e`.
    // The start `g` is still pending, so the schedule stays unresolved.
    const dsl =
      "VEST FROM EVENT g OVER 48 months EVERY 1 month CLIFF EARLIER OF (DATE 2026-01-01, EVENT e)";
    const schedule = evaluateProgram(
      prog(dsl),
      deferred({ events: { e: "2025-07-01" } }),
    );
    expect(schedule.resolvesTo.status).toBe("unresolved");
    expect(
      schedule.absenceAssumptions.find((a) => a.eventId === "e"),
    ).toBeUndefined();
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toBeUndefined();
  });

  it("stays fully silent when the floor arm is measured from the vesting start", () => {
    // With the time arm relative to the (still-pending) vesting start, the arm can't
    // resolve under the start-blind ctx, so the fold never commits to a floor and there
    // is no coherent `through` to stamp. `e` is emitted nowhere — neither an absence
    // assumption nor a bare pending blocker. This full silence is intended; surfacing a
    // date-less blocker during the pending window is deferred to #509.
    const dsl =
      "VEST FROM EVENT g OVER 48 months EVERY 1 month CLIFF EARLIER OF (+12 months, EVENT e)";
    const schedule = evaluateProgram(prog(dsl), deferred());
    expect(schedule.resolvesTo.status).toBe("unresolved");
    expect(
      schedule.absenceAssumptions.find((a) => a.eventId === "e"),
    ).toBeUndefined();
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toBeUndefined();
  });

  it("discloses nothing when the deferred cliff has no committed floor", () => {
    // A DAYS cliff on a MONTHS grid is cross-unit, so it can't derive a relative
    // duration and reaches the same fall-through — but it has no EARLIER OF / event
    // floor, so the harvest is empty. The fix must not over-fire: only `g`'s bare wait
    // remains, and it is not disclosed.
    const dsl = "VEST FROM EVENT g OVER 48 months EVERY 1 month CLIFF +90 days";
    const schedule = evaluateProgram(prog(dsl), deferred());
    expect(schedule.resolvesTo.status).toBe("unresolved");
    expect(schedule.absenceAssumptions).toEqual([]);
  });
});

// The materiality invariant is written down in the types, not just in reviewers'
// heads. Anchor on the stable heading only, so minor wording edits don't break it.
describe("the materiality invariant is recorded in the types", () => {
  it("evaluation.ts carries the invariant comment block", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../types/src/evaluation.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("Materiality invariant");
  });
});

describe("#251 AC16 — LATER OF unregressed", () => {
  it("LATER OF (DATE future, EVENT ipo), ipo unfired → still pending (upper bound, no commit)", () => {
    const dsl =
      "VEST FROM LATER OF (DATE 2024-06-01, EVENT ipo) OVER 12 months EVERY 1 month";
    const schedule = evaluateProgram(prog(dsl), ctx());
    // LATER OF's resolved arm is an upper bound, so it must NOT commit to a date —
    // it stays a synthetic-event template waiting on ipo (no dated installments).
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    const dated = schedule.resolvesTo.installments.filter(
      (i) => i.state === "RESOLVED",
    );
    expect(dated).toHaveLength(0);
    expect(findUnfired(schedule.resolvesTo.pending, "ipo")).toBeDefined();
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
    expect(findUnfired(schedule.resolvesTo.pending, "e")).toEqual({
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
    expect(findUnfired(schedule.resolvesTo.pending, "x")).toBeDefined();
  });
});

describe("#251 AC17 — schedule-level EARLIER START OF behaves as the node-level case", () => {
  it("EARLIER START OF commits to the date floor and discloses ipo", () => {
    const dsl =
      "VEST EARLIER START OF (FROM DATE 2024-06-01 OVER 12 months EVERY 1 month, FROM EVENT ipo OVER 12 months EVERY 1 month)";
    const schedule = evaluateProgram(prog(dsl), ctx());
    if (schedule.resolvesTo.status !== "template")
      throw new Error(`expected template, got ${schedule.resolvesTo.status}`);
    expect(schedule.resolvesTo.runtime.startDate).toBe("2024-06-01");
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
