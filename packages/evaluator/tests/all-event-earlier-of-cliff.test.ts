// A cliff `EARLIER OF` whose arms all reference an event stores the same way its
// nested-under-a-`LATER OF` sibling already does: one synthetic `event_condition`,
// no time cliff, the whole `EARLIER OF` carried verbatim as the recipe. An
// `EARLIER OF` with any pure time/date arm stays acceleration and keeps its plain
// time-cliff lowering. These exercise the whole-schedule verdicts; the lowering
// shape is pinned in resolve.cliff.test.ts and the full artifact in the pipeline
// persist suite.

import { describe, it, expect } from "vitest";
import type { AsOfContextInput, Blocker } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/evaluate";

const prog = (dsl: string) => normalizeProgram(parse(dsl));

const ctx = (overrides: Partial<AsOfContextInput> = {}): AsOfContextInput => ({
  grantDate: "2025-01-01",
  grantQuantity: 4800,
  events: {},
  asOf: "2026-06-01",
  ...overrides,
});

// Recursively search a blocker tree for an unfired-event leaf and its `through`.
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

// The headline construct: an `EARLIER OF` over two gated events, no time arm.
const DSL =
  "VEST OVER 4 years EVERY 1 month CLIFF EARLIER OF " +
  "(event IPO before grantDate + 7 years, event CIC before grantDate + 7 years)";

const RECIPE =
  "EARLIER OF (EVENT IPO BEFORE EVENT grantDate +84 months, " +
  "EVENT CIC BEFORE EVENT grantDate +84 months)";

// Evaluate the headline construct against a firing set (closed-world).
const evalWith = (events: Record<string, string> = {}) =>
  evaluateProgram(prog(DSL), ctx({ events }));

// The RESOLVED {date, amount} tranches of a closed-world reading.
const resolvedOf = (schedule: ReturnType<typeof evaluateProgram>) =>
  schedule.resolvesTo.status === "template"
    ? schedule.resolvesTo.installments.flatMap((i) =>
        i.state === "RESOLVED" ? [{ date: i.date, amount: i.amount }] : [],
      )
    : [];

describe("all-event EARLIER OF cliff — storable verdict", () => {
  it("flips from unrepresentable to a single synthetic event_condition template", () => {
    const schedule = evalWith();
    // The whole point: the bare case used to be `unrepresentable`; it now stores.
    if (schedule.storable.status !== "template")
      throw new Error(
        `expected storable template, got ${schedule.storable.status}`,
      );
    // No time cliff on the schedule; one event_condition on the synthetic evt:1.
    expect(schedule.storable.template.statements[0]).toEqual({
      order: 1,
      percentage: "1",
      schedule: { occurrences: 48, period: 1, period_type: "MONTHS" },
      event_condition: { event_id: "evt:1" },
    });
    // The start stays dated (grant date) — only the cliff is event-held.
    expect(schedule.storable.runtime).toEqual({
      startDate: "2025-01-01",
      grantDate: "2025-01-01",
    });
    // The recipe is the whole EARLIER OF verbatim, re-resolved on reload.
    expect(schedule.storable.sourceMap).toEqual({
      "evt:1": { definition: RECIPE },
    });
  });

  it("stays storable as a template even with a deferred (pending-event) start", () => {
    // FROM EVENT hire, hire unfired → the cliff lowers through the deferred path; it
    // must reach the same synthetic-event shape, not fall back to unrepresentable.
    const deferred =
      "VEST FROM EVENT hire OVER 4 years EVERY 1 month CLIFF EARLIER OF " +
      "(event IPO before grantDate + 7 years, event CIC before grantDate + 7 years)";
    const schedule = evaluateProgram(prog(deferred), ctx());
    expect(schedule.storable.status).toBe("template");
  });
});

describe("all-event EARLIER OF cliff — closed-world resolution", () => {
  it("folds at the fired arm and discloses the still-open arm's absence", () => {
    // IPO fires inside its gate window, CIC still open. The fold commits to the IPO
    // date (18 months accrued of 4800 = 1800) — the earliest live arm.
    const schedule = evalWith({ IPO: "2026-07-01" });
    expect(schedule.resolvesTo.status).toBe("template");
    const r = resolvedOf(schedule);
    expect(r[0]).toEqual({ date: "2026-07-01", amount: 1800 });
    expect(r.reduce((n, i) => n + i.amount, 0)).toBe(4800);
    // CIC's absence is what the fold leans on — it must be surfaced, not silently
    // dropped on this new path. Its arm is gated (BEFORE grantDate + 84 months), so
    // the disclosure is the gate-window one: CIC assumed absent through 2032-01-01.
    expect(findUnfired(schedule.resolvesTo.pending, "CIC")).toEqual({
      through: "2032-01-01",
    });
    expect(schedule.absenceAssumptions).toContainEqual(
      expect.objectContaining({ eventId: "CIC" }),
    );
    // IPO fired — a real firing is never an absence assumption.
    expect(schedule.absenceAssumptions.some((a) => a.eventId === "IPO")).toBe(
      false,
    );
  });

  it("folds at the earlier arm when both fire, with nothing to disclose", () => {
    // CIC (2026-05-01) is earlier than IPO (2027-01-01); the min picks CIC — 16
    // months accrued = 1600. Both fired, so nothing is assumed absent.
    const schedule = evalWith({ IPO: "2027-01-01", CIC: "2026-05-01" });
    expect(resolvedOf(schedule)[0]).toEqual({
      date: "2026-05-01",
      amount: 1600,
    });
    expect(schedule.absenceAssumptions).toEqual([]);
  });

  it("both within window → RESOLVED at the earlier, nothing disclosed", () => {
    const schedule = evalWith({ IPO: "2026-07-01", CIC: "2026-09-01" });
    expect(resolvedOf(schedule)[0]).toEqual({
      date: "2026-07-01",
      amount: 1800,
    });
    expect(schedule.absenceAssumptions).toEqual([]);
  });

  it("both fire after the gate window → impossible (both gates violated)", () => {
    const schedule = evalWith({ IPO: "2033-01-01", CIC: "2033-01-01" });
    expect(schedule.resolvesTo.status).toBe("impossible");
  });

  it("no firings → held on the REAL events, never the minted synthetic id", () => {
    const schedule = evalWith();
    // Both real events are disclosed; the synthetic evt:1 must never leak out to a
    // consumer as an event name.
    expect(findUnfired(schedule.resolvesTo.pending, "IPO")).toBeDefined();
    expect(findUnfired(schedule.resolvesTo.pending, "CIC")).toBeDefined();
    expect(
      [...new Set(schedule.absenceAssumptions.map((a) => a.eventId))].sort(),
    ).toEqual(["CIC", "IPO"]);
    expect(JSON.stringify(schedule.resolvesTo.pending)).not.toContain("evt:1");
  });
});
