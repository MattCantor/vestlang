import { describe, it, expect } from "vitest";
import {
  runPersist,
  runRehydrate,
  type PersistInput,
  type RehydrateInput,
} from "../src/persist.js";

// Direct function-level tests of the persist/rehydrate orchestration, now that it
// lives in the pipeline. The MCP-boundary suite (apps/mcp-server) still exercises
// zod validation and tool wiring; these pin the orchestration where it sits.
// Neither operation reads an observation date — they resolve a schedule's
// structural state (which template, which witnesses), the same whenever you ask —
// so their output never moves with the wall clock.

const COMBINATOR_DSL =
  "VEST FROM EARLIER OF (EVENT ipo, DATE 2027-01-01) OVER 48 months EVERY 1 month";
const TIME_BASED_DSL = "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month";
const BARE_EVENT_DSL =
  "VEST FROM EVENT ipo OVER 4 months EVERY 1 month CLIFF +2 months";

function persistOk(input: PersistInput) {
  const r = runPersist(input);
  if (!r.ok) throw new Error(`expected persist ok, got: ${r.error}`);
  return r;
}

function rehydrateOk(input: RehydrateInput) {
  const r = runRehydrate(input);
  if (!r.ok) throw new Error(`expected rehydrate ok, got: ${r.error}`);
  return r;
}

describe("runPersist (AC#4)", () => {
  it("refuses a lint-error program, naming the diagnostic", () => {
    // An empty date window (AFTER 2026 AND BEFORE 2025) is statically dead — the
    // linter flags it as an error before evaluation.
    const r = runPersist({
      dsl: "VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unsatisfiable-date-window/);
  });

  it("refuses an over-allocating program, naming the over-allocation", () => {
    // 6000 shares on a 4800-share grant — a clean single template, so only the
    // validity gate catches it.
    const r = runPersist({
      dsl: "6000 VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/over-allocat/);
  });

  it("refuses a non-template resolution, naming the status", () => {
    // An event-anchored cliff can't be one canonical template (the cliff is
    // duration-only), so it resolves to a non-template shape.
    const r = runPersist({
      dsl: "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month CLIFF EVENT ipo",
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("template");
  });

  it("returns the artifact plus pending/dead for a pending template (dead is [])", () => {
    const r = persistOk({
      dsl: COMBINATOR_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });
    expect(r.artifact.template.statements.length).toBeGreaterThan(0);
    expect(r.artifact.sidecar).toBeDefined();
    // The gate hasn't fired — its witness rides in pending; a storable template
    // never carries a dead blocker.
    expect(r.pending.length).toBeGreaterThan(0);
    expect(r.dead).toEqual([]);
  });

  it("returns empty pending/dead for a fully-dated template", () => {
    const r = persistOk({
      dsl: TIME_BASED_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1200,
    });
    expect(r.artifact.sidecar).toBeUndefined();
    expect(r.pending).toEqual([]);
    expect(r.dead).toEqual([]);
  });

  it("still persists an under-allocating program (warning, not error)", () => {
    const r = persistOk({
      dsl: "1/2 VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS",
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });
    expect(r.artifact.template.statements.length).toBeGreaterThan(0);
  });
});

describe("runRehydrate (AC#5)", () => {
  it("refuses an artifact with no stored grant date", () => {
    const r = runRehydrate({
      artifact: {
        template: { id: "t1", statements: [] },
        // grantDate deliberately absent
        runtime: { startDate: "2025-01-01" },
      },
      grant_quantity: 400,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/grant date/i);
  });

  it("refuses a corrupt stored definition, naming the event and not leaking parser text", () => {
    const r = runRehydrate({
      artifact: {
        template: {
          id: "t1",
          statements: [
            {
              order: 1,
              vesting_base: { type: "EVENT", event_id: "evt_1" },
              occurrences: 4,
              period: 1,
              period_type: "MONTHS",
              percentage: { numerator: 1, denominator: 1 },
            },
          ],
        },
        runtime: { grantDate: "2025-01-01" },
        sidecar: { vestlang: { evt_1: { definition: "TOTALLY NOT DSL ((" } } },
      },
      grant_quantity: 400,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("evt_1");
      expect(r.error).toMatch(/corrupt|unparseable/i);
      expect(r.error).not.toContain('Expected "DATE"');
    }
  });

  it("computes the firing delta, projection, and pending split after the event fires", () => {
    const persisted = persistOk({
      dsl: COMBINATOR_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });
    const out = rehydrateOk({
      artifact: persisted.artifact,
      grant_quantity: 1000,
      events: { ipo: "2026-06-01" },
    });
    // The synthetic id resolves to ipo (before the 2027 date); the delta carries it
    // with the sidecar definition.
    expect(out.firings_to_apply).toHaveLength(1);
    expect(out.firings_to_apply[0].date).toBe("2026-06-01");
    expect(out.firings_to_apply[0].definition).toContain("ipo");
    expect(out.pending).toHaveLength(0);
    expect(out.dead).toHaveLength(0);
    expect(out.projection).toHaveLength(48);
    expect(out.projection[0].date).toBe("2026-07-01");
    expect(out.projection.reduce((s, i) => s + i.amount, 0)).toBe(1000);
  });

  it("discloses a still-waiting bare EVENT as pending with an empty projection", () => {
    const persisted = persistOk({
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
    });
    const out = rehydrateOk({
      artifact: persisted.artifact,
      grant_quantity: 400,
    });
    expect(out.firings_to_apply).toHaveLength(0);
    expect(out.projection).toHaveLength(0);
    expect(
      out.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });

  it("files a contradicted gate under dead, not pending", () => {
    // ipo must fire strictly inside (2026-01-01, 2026-06-01); firing in 2027
    // contradicts the gate.
    const persisted = persistOk({
      dsl: "VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2026-06-01 OVER 1 YEAR EVERY 3 MONTHS",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });
    const out = rehydrateOk({
      artifact: persisted.artifact,
      grant_quantity: 4800,
      events: { ipo: "2027-01-01" },
    });
    expect(out.dead.length).toBeGreaterThan(0);
    expect(out.dead.some((b) => b.type === "IMPOSSIBLE_CONDITION")).toBe(true);
    expect(out.pending).toHaveLength(0);
  });

  it("sizes the projection to the supplied grant_quantity (a bare EVENT cliff schedule)", () => {
    const persisted = persistOk({
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
    });
    const out = rehydrateOk({
      artifact: persisted.artifact,
      grant_quantity: 400,
      events: { ipo: "2025-01-31" },
    });
    // 400 shares: ½ at the 2-month cliff, the rest monthly.
    expect(out.projection).toEqual([
      { date: "2025-03-31", amount: 200 },
      { date: "2025-04-30", amount: 100 },
      { date: "2025-05-31", amount: 100 },
    ]);
    expect(out.firings_to_apply).toEqual([
      { event_id: "ipo", date: "2025-01-31", definition: null },
    ]);
  });
});

describe("persist/rehydrate are clock-independent", () => {
  // Both operations resolve a schedule's structural state — which canonical
  // template, which witnesses the firings imply — and that answer is the same
  // whenever you ask. No observation date enters either one (neither takes an
  // `as_of`, and neither reads `todayISO()`), so output never moves with the wall
  // clock. These pins lock that down as fixed-output regressions.

  it("persist yields a fixed result independent of today's date", () => {
    // Run twice; nothing reads the clock, so the two artifacts are byte-identical.
    const a = persistOk({
      dsl: TIME_BASED_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1200,
    });
    const b = persistOk({
      dsl: TIME_BASED_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1200,
    });
    expect(a.artifact).toEqual(b.artifact);
    // A fully-dated template is template-resolved at grant time, not "unvested as of
    // today" — pending/dead are empty whatever the wall clock says.
    expect(a.pending).toEqual([]);
    expect(a.dead).toEqual([]);
    expect(a.artifact.template.statements.length).toBeGreaterThan(0);
  });

  it("rehydrate evaluates against the stored grant date, not today", () => {
    // The grant + firing are years in the past, but the witness/projection don't
    // shift with the run date: rehydration reads the artifact's frozen grant date
    // and the supplied firings, never the clock.
    const persisted = persistOk({
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
    });
    const out1 = rehydrateOk({
      artifact: persisted.artifact,
      grant_quantity: 400,
      events: { ipo: "2025-01-31" },
    });
    const out2 = rehydrateOk({
      artifact: persisted.artifact,
      grant_quantity: 400,
      events: { ipo: "2025-01-31" },
    });
    expect(out1).toEqual(out2);
    expect(out1.projection).toEqual([
      { date: "2025-03-31", amount: 200 },
      { date: "2025-04-30", amount: 100 },
      { date: "2025-05-31", amount: 100 },
    ]);
  });
});
