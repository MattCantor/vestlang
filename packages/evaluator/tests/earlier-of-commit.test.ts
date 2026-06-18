// Issue #251 — EARLIER OF with a settled date arm commits to that floor in the
// closed-world `resolution` verdict (only), discloses the still-pending arm, and
// no longer freezes the grid. The interchange verdict stays firing-blind and never
// commits. These crystallize the issue's numbered acceptance criteria.

import { describe, it, expect } from "vitest";
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
  it("the headline's interchange is still a synthetic-event template, invariant to ipo", () => {
    const blind = evaluateProgram(prog(HEADLINE), ctx());
    const fired = evaluateProgram(
      prog(HEADLINE),
      ctx({ events: { ipo: "2024-03-01" } }),
    );
    // Firing-blind: a synthetic-event template with one source-map entry.
    if (blind.interchange.status !== "template")
      throw new Error("expected interchange template");
    expect(blind.interchange.template.statements[0].vesting_base.type).toBe(
      "EVENT",
    );
    expect(Object.keys(blind.interchange.sourceMap)).toHaveLength(1);
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
