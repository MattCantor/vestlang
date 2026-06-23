import { describe, it, expect } from "vitest";
import type { PersistedArtifact } from "@vestlang/evaluator";
import { CONTINGENT_START_SENTINEL } from "@vestlang/primitives";
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
  if (!r.ok) throw new Error(`expected persist ok, got: ${r.error.message}`);
  return r;
}

function rehydrateOk(input: RehydrateInput) {
  const r = runRehydrate(input);
  if (!r.ok) throw new Error(`expected rehydrate ok, got: ${r.error.message}`);
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
    if (!r.ok) {
      expect(r.error.ruleId).toBe("persist-not-storable");
      expect(r.error.message).toMatch(/unsatisfiable-date-window/);
    }
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
    if (!r.ok) {
      expect(r.error.ruleId).toBe("persist-not-storable");
      expect(r.error.message).toMatch(/over-allocat/);
    }
  });

  it("refuses a non-template resolution, naming the status", () => {
    // Two independent absolute-date grids can't be one canonical template (a record
    // keeper models them as separate grants), so this resolves to events-only.
    const r = runPersist({
      dsl:
        "1/2 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 12 months " +
        "PLUS 1/2 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 12 months",
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.ruleId).toBe("persist-not-storable");
      expect(r.error.message).toContain("template");
    }
  });

  it("returns the artifact plus pending/dead for a pending template (dead is [])", () => {
    const r = persistOk({
      dsl: COMBINATOR_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });
    expect(r.artifact.template.statements.length).toBeGreaterThan(0);
    expect(r.artifact.sidecar).toBeDefined();
    // The gate hasn't fired — its witness rides in `pending`, and nothing is dead
    // here (no firing has contradicted it yet). `dead` CAN be non-empty for a
    // storable schedule once a recorded firing dies a gate, but this one is clean.
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
    if (!r.ok) {
      expect(r.error.ruleId).toBe("rehydrate-missing-grant-date");
      expect(r.error.message).toMatch(/grant date/i);
    }
  });

  it("refuses a corrupt stored start recipe, naming evt:start and not leaking parser text", () => {
    // A contingent placeholder (sentinel startDate) whose `evt:start` recipe is
    // corrupt: the start can't be re-derived, so reload refuses.
    const r = runRehydrate({
      artifact: {
        template: {
          id: "t1",
          statements: [
            {
              order: 1,
              vesting_base: { type: "DATE" },
              occurrences: 4,
              period: 1,
              period_type: "MONTHS",
              percentage: "1",
            },
          ],
        },
        runtime: {
          grantDate: "2025-01-01",
          startDate: CONTINGENT_START_SENTINEL,
        },
        sidecar: {
          vestlang: { "evt:start": { definition: "TOTALLY NOT DSL ((" } },
        },
      },
      grant_quantity: 400,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.ruleId).toBe("rehydrate-corrupt-definition");
      expect(r.error.message).toContain("evt:start");
      expect(r.error.message).toMatch(/corrupt|unparseable/i);
      expect(r.error.message).not.toContain('Expected "DATE"');
    }
  });

  it("re-derives the contingent start, projection, and pending split after the event fires", () => {
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
    // The evt:start recipe resolves to ipo (before the 2027 date). It surfaces as
    // start_to_apply (distinct from firings_to_apply, which stays empty).
    expect(out.firings_to_apply).toHaveLength(0);
    expect(out.start_to_apply).toEqual({ date: "2026-06-01" });
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
    expect(out.start_to_apply).toBeNull();
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
    // The bare EVENT start re-derives to its firing as the contingent start.
    expect(out.firings_to_apply).toEqual([]);
    expect(out.start_to_apply).toEqual({ date: "2025-01-31" });
  });
});

describe("runRehydrate refuses an over-allocating artifact (AC#1–#4, #6)", () => {
  // A persisted artifact can be hand-built, edited in external storage, or come
  // from a foreign tool — so rehydrate re-checks that its statement percentages
  // don't sum past the whole grant before it ever compiles a projection.

  // The issue's repro: one DATE-anchored statement claiming 5/4 of the grant, on a
  // 4800-share grant, would project [1500,1500,1500,1500] = 6000 shares.
  const overAllocatingDateArtifact = (): PersistedArtifact => ({
    template: {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: { type: "DATE" },
          occurrences: 4,
          period: 3,
          period_type: "MONTHS",
          percentage: "1.25",
        },
      ],
    },
    runtime: { grantDate: "2025-01-01", startDate: "2025-01-01" },
  });

  it("AC#1: refuses the issue repro, with no projection ever materialized", () => {
    const r = runRehydrate({
      artifact: overAllocatingDateArtifact(),
      grant_quantity: 4800,
    });
    expect(r.ok).toBe(false);
    // The over-vesting stream must never be built — not merely flagged.
    expect(r).not.toHaveProperty("projection");
  });

  it("AC#2: the refusal names the over-allocation and the damaged-artifact guidance", () => {
    const r = runRehydrate({
      artifact: overAllocatingDateArtifact(),
      grant_quantity: 4800,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("rehydrate-over-allocation");
    // The formatFinding clause: 125% and the exact fraction.
    expect(r.error.message).toContain("125%");
    expect(r.error.message).toContain("5/4");
    // Plus the shared damaged-artifact guidance the other refusals carry.
    expect(r.error.message).toContain(
      "The artifact appears to be damaged; supply one built by vestlang_persist.",
    );
  });

  it("AC#3: catches over-allocation summed across multiple statements", () => {
    // 3/4 + 3/4 = 3/2 — each statement is fine alone, the sum is not.
    const r = runRehydrate({
      artifact: {
        template: {
          id: "t1",
          statements: [
            {
              order: 1,
              vesting_base: { type: "DATE" },
              occurrences: 1,
              period: 12,
              period_type: "MONTHS",
              percentage: "0.75",
            },
            {
              order: 2,
              vesting_base: { type: "DATE" },
              occurrences: 1,
              period: 12,
              period_type: "MONTHS",
              percentage: "0.75",
            },
          ],
        },
        runtime: { grantDate: "2025-01-01", startDate: "2025-01-01" },
      },
      grant_quantity: 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.ruleId).toBe("rehydrate-over-allocation");
      expect(r.error.message).toMatch(/over-allocat/);
    }
  });

  it("AC#4: an exactly-1 (1/2 + 1/2) artifact still rehydrates, with the full payload", () => {
    // The over/exact boundary: summing to exactly the whole grant is valid.
    const out = rehydrateOk({
      artifact: {
        template: {
          id: "t1",
          statements: [
            {
              order: 1,
              vesting_base: { type: "DATE" },
              occurrences: 1,
              period: 12,
              period_type: "MONTHS",
              percentage: "0.5",
            },
            {
              order: 2,
              vesting_base: { type: "DATE" },
              occurrences: 1,
              period: 12,
              period_type: "MONTHS",
              percentage: "0.5",
            },
          ],
        },
        runtime: { grantDate: "2025-01-01", startDate: "2025-01-01" },
      },
      grant_quantity: 1000,
    });
    expect(out.projection).toBeDefined();
    expect(out.firings_to_apply).toEqual([]);
    expect(out.pending).toEqual([]);
    expect(out.dead).toEqual([]);
    expect(out.projection.reduce((s, i) => s + i.amount, 0)).toBe(1000);
  });

  it("AC#4: an under-allocating (1/2) artifact still rehydrates — under is a warning", () => {
    const out = rehydrateOk({
      artifact: {
        template: {
          id: "t1",
          statements: [
            {
              order: 1,
              vesting_base: { type: "DATE" },
              occurrences: 2,
              period: 6,
              period_type: "MONTHS",
              percentage: "0.5",
            },
          ],
        },
        runtime: { grantDate: "2025-01-01", startDate: "2025-01-01" },
      },
      grant_quantity: 1000,
    });
    expect(out.projection).toBeDefined();
    expect(out.firings_to_apply).toEqual([]);
    expect(out.pending).toEqual([]);
    expect(out.dead).toEqual([]);
    // Only half the grant vests — the rest is legally left unvested.
    expect(out.projection.reduce((s, i) => s + i.amount, 0)).toBe(500);
  });

  it("AC#6: an over-allocating contingent-start artifact is refused before the start resolves", () => {
    // The over-allocating statement is a contingent start whose event has NOT fired
    // (sentinel startDate + an evt:start recipe). The gate reads the template alone
    // (firing-independent), so it pre-empts the "re-derive the start" path: a
    // refusal, not a pending/empty projection.
    const r = runRehydrate({
      artifact: {
        template: {
          id: "t1",
          statements: [
            {
              order: 1,
              vesting_base: { type: "DATE" },
              occurrences: 4,
              period: 3,
              period_type: "MONTHS",
              percentage: "1.25",
            },
          ],
        },
        runtime: {
          grantDate: "2025-01-01",
          startDate: CONTINGENT_START_SENTINEL,
        },
        sidecar: { vestlang: { "evt:start": { definition: "EVENT ipo" } } },
      },
      grant_quantity: 4800,
      // ipo intentionally not supplied — the gate must still fire.
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("rehydrate-over-allocation");
    expect(r.error.message).toContain("125%");
    expect(r.error.message).toContain("over-allocat");
    expect(r).not.toHaveProperty("projection");
    expect(r).not.toHaveProperty("pending");
  });

  it("a zero-share grant on an over-allocating template is NOT refused (nothing to allocate)", () => {
    // The zero guard lives in the shared primitive, so rehydrate inherits persist's
    // behavior: no shares means no allocation to over-run, hence no refusal.
    const out = rehydrateOk({
      artifact: overAllocatingDateArtifact(),
      grant_quantity: 0,
    });
    expect(out.projection).toBeDefined();
  });
});

describe("runRehydrate guards the reserved namespace + the contingency marker", () => {
  // A contingent placeholder: a DATE statement on the sentinel startDate.
  const contingentArtifact = (
    sidecar?: PersistedArtifact["sidecar"],
  ): PersistedArtifact => ({
    template: {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: { type: "DATE" },
          occurrences: 4,
          period: 1,
          period_type: "MONTHS",
          percentage: "1",
        },
      ],
    },
    runtime: { grantDate: "2025-01-01", startDate: CONTINGENT_START_SENTINEL },
    ...(sidecar ? { sidecar } : {}),
  });

  it("maps a non-reserved sidecar key to rehydrate-namespace-violation, naming the key", () => {
    // `evt_1` is a legal user Ident outside the `evt:` namespace — a tampered key.
    const r = runRehydrate({
      artifact: contingentArtifact({
        vestlang: {
          "evt:start": { definition: "EVENT ipo" },
          evt_1: { definition: "LATER OF(EVENT a, EVENT b)" },
        },
      }),
      grant_quantity: 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.ruleId).toBe("rehydrate-namespace-violation");
      expect(r.error.message).toContain("evt_1");
      // This path never reparses, so it carries no raw parser text.
      expect(r.error.message).not.toContain('Expected "DATE"');
    }
  });

  it("rejects a stray evt:<garbage> key (neither evt:start nor numbered) (AC 8)", () => {
    const r = runRehydrate({
      artifact: contingentArtifact({
        vestlang: { "evt:bogus": { definition: "EVENT ipo" } },
      }),
      grant_quantity: 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.ruleId).toBe("rehydrate-namespace-violation");
      expect(r.error.message).toContain("evt:bogus");
    }
  });

  it("refuses a damaged artifact: sentinel start with no evt:start recipe", () => {
    const r = runRehydrate({
      artifact: contingentArtifact(),
      grant_quantity: 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.ruleId).toBe("rehydrate-missing-start-marker");
      expect(r.error.message).toContain(
        "The artifact appears to be damaged; supply one built by vestlang_persist.",
      );
    }
  });

  it("leaves a contingent start pending when its event is unfired, not refused", () => {
    const out = rehydrateOk({
      artifact: contingentArtifact({
        vestlang: { "evt:start": { definition: "EVENT ipo" } },
      }),
      grant_quantity: 1000,
    });
    expect(out.firings_to_apply).toEqual([]);
    expect(out.start_to_apply).toBeNull();
    expect(
      out.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
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

describe("#251 — persist gates on interchange; rehydrate never commits", () => {
  // AC#7 — an EARLIER OF cliff resolves to `template` (it commits its floor) but its
  // interchange is `unrepresentable` (an event arm can't be a duration cliff). Persist
  // gates on interchange, so it must REFUSE — gating on resolution would store the
  // unstorable.
  it("AC#7: persist refuses an EARLIER OF cliff even though its resolution is a template", () => {
    const r = runPersist({
      dsl: "VEST OVER 48 months EVERY 1 month CLIFF EARLIER OF (+12 months, EVENT fda)",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.ruleId).toBe("persist-not-storable");
      expect(r.error.message).toMatch(/unrepresentable/);
    }
  });

  // AC#8 — persist is firing-invariant by construction. The combinator gate is
  // storable firing-blind; supplying ipo at persist does NOT bake a firing, and the
  // artifact is byte-identical to persisting blind. Reload without resupply stays
  // pending; resupplying re-derives it.
  it("AC#8: a firing supplied at persist is not stored; reload without resupply is pending", () => {
    const withFiring = persistOk({
      dsl: COMBINATOR_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
      events: { ipo: "2026-06-01" },
    });
    const blind = persistOk({
      dsl: COMBINATOR_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });
    expect(withFiring.artifact).toEqual(blind.artifact);
    expect(withFiring.artifact.runtime.eventFirings ?? []).toHaveLength(0);

    const reload = rehydrateOk({
      artifact: withFiring.artifact,
      grant_quantity: 1000,
      // ipo not resupplied.
    });
    expect(reload.start_to_apply).toBeNull();
    expect(reload.pending.length).toBeGreaterThan(0);

    const resupplied = rehydrateOk({
      artifact: withFiring.artifact,
      grant_quantity: 1000,
      events: { ipo: "2026-06-01" },
    });
    expect(resupplied.start_to_apply).toEqual({ date: "2026-06-01" });
    expect(resupplied.pending).toHaveLength(0);
  });

  // AC#9 — persist may surface a non-empty `dead`. A windowed gate is storable
  // firing-blind (interchange template), yet a firing recorded OUTSIDE its window at
  // persist time dies the gate in the closed-world resolution. So persist returns
  // ok:true WITH a non-empty `dead` (a revisable disclosure — events are the system
  // of record's, not the artifact's).
  it("AC#9: persist returns ok:true with a non-empty dead when a recorded firing dies the gate", () => {
    const r = runPersist({
      dsl: "VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2026-06-01 OVER 1 YEAR EVERY 3 MONTHS",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
      events: { ipo: "2027-01-01" }, // fired past the BEFORE bound → dead
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dead.length).toBeGreaterThan(0);
      // Still firing-invariant: the artifact bakes no firing.
      expect(r.artifact.runtime.eventFirings ?? []).toHaveLength(0);
    }
  });

  // AC#10 — rehydrate does not commit. A stored EARLIER OF gate reloaded with NO real
  // firing must stay pending — it must not resolve to its date floor on reload (which
  // would fabricate a firing the world never produced).
  it("AC#10: a stored EARLIER OF gate reloaded with no firing stays pending (no commit)", () => {
    const persisted = persistOk({
      dsl: COMBINATOR_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });
    const out = rehydrateOk({
      artifact: persisted.artifact,
      grant_quantity: 1000,
      // ipo unfired — the only world the gate could read.
    });
    // No witness resolved (it did NOT commit to the 2027 date floor), and the
    // projection is empty: still pending.
    expect(out.firings_to_apply).toHaveLength(0);
    expect(out.projection).toHaveLength(0);
    expect(out.pending.length).toBeGreaterThan(0);
  });
});

// #255 — the event-held cliff round-trip: persist an event_condition, then
// rehydrate against the world's firings and confirm the projection folds.
describe("runPersist/runRehydrate — event_condition round-trip (#255)", () => {
  // AC 12: a bare event cliff persists with an event_condition on the statement and
  // NO sidecar recipe (the SoR owns the real event). Rehydrating with the event
  // fired folds the grid; firings_to_apply is empty (the SoR already knows it).
  it("AC12/AC14: a bare event cliff round-trips; firings_to_apply stays empty", () => {
    const persisted = persistOk({
      dsl: "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month CLIFF EVENT ipo",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });
    const stmt = persisted.artifact.template.statements[0];
    expect(stmt.event_condition).toEqual({ event_id: "ipo" });
    expect(stmt.cliff).toBeUndefined();
    // No sidecar: a bare real event needs no recipe.
    expect(persisted.artifact.sidecar).toBeUndefined();

    // Rehydrate with ipo fired @ month 30 (2027-07-01): folds 3000 at the firing.
    const out = rehydrateOk({
      artifact: persisted.artifact,
      grant_quantity: 4800,
      events: { ipo: "2027-07-01" },
    });
    expect(out.firings_to_apply).toHaveLength(0); // bare real event — SoR knows it
    expect(out.projection[0]).toEqual({ date: "2027-07-01", amount: 3000 });
    expect(out.projection.reduce((a, e) => a + e.amount, 0)).toBe(4800);

    // Unfired → held: nothing projects.
    const held = rehydrateOk({
      artifact: persisted.artifact,
      grant_quantity: 4800,
    });
    expect(held.projection).toHaveLength(0);
    expect(held.firings_to_apply).toHaveLength(0);
  });

  // AC 14: a SYNTHETIC event_condition (CLIFF LATER OF(EVENT a, EVENT b)) persists
  // with its recipe in the sidecar; rehydrating with a and b fired surfaces the
  // computed release max(a, b) in firings_to_apply.
  it("AC14: a synthetic event_condition surfaces max(a,b) in firings_to_apply", () => {
    const persisted = persistOk({
      dsl: "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month CLIFF LATER OF(EVENT a, EVENT b)",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });
    const ec = persisted.artifact.template.statements[0].event_condition;
    expect(ec?.event_id).toMatch(/^evt:\d+$/);
    // The recipe rides in the sidecar.
    expect(persisted.artifact.sidecar).toBeDefined();

    const out = rehydrateOk({
      artifact: persisted.artifact,
      grant_quantity: 4800,
      events: { a: "2026-03-01", b: "2026-07-01" },
    });
    // The computed release is pushed: { event_id: evt:<n>, date: max(a,b) }.
    expect(out.firings_to_apply).toHaveLength(1);
    expect(out.firings_to_apply[0]).toMatchObject({
      event_id: ec?.event_id,
      date: "2026-07-01", // max(a, b)
    });
  });

  // AC 11: a compound contingency (event start + event cliff) persists as a
  // template — a sentinel start + evt:start recipe AND the cliff's event_condition,
  // both sidecar-carried. Projects nothing until BOTH fire; once both fire, the
  // grid anchors at the re-derived start and folds at the cliff firing.
  it("AC11: a compound (event start + event cliff) round-trips and needs BOTH firings", () => {
    const persisted = persistOk({
      dsl: "VEST FROM EVENT ipo OVER 48 months EVERY 1 month CLIFF EVENT board",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });
    expect(persisted.artifact.runtime.startDate).toBe(
      CONTINGENT_START_SENTINEL,
    );
    expect(persisted.artifact.template.statements[0].event_condition).toEqual({
      event_id: "board",
    });
    // The start recipe is carried; both halves are sidecar-present (evt:start).
    expect(
      persisted.artifact.sidecar?.vestlang["evt:start"]?.definition,
    ).toContain("ipo");

    // Neither fired → held.
    expect(
      rehydrateOk({ artifact: persisted.artifact, grant_quantity: 4800 })
        .projection,
    ).toHaveLength(0);

    // Only the start fired → still held by the cliff.
    const startOnly = rehydrateOk({
      artifact: persisted.artifact,
      grant_quantity: 4800,
      events: { ipo: "2025-06-01" },
    });
    expect(startOnly.start_to_apply).toEqual({ date: "2025-06-01" });
    expect(startOnly.projection).toHaveLength(0); // board still holds the grid

    // Both fired → the grid anchors at ipo and folds at board.
    const both = rehydrateOk({
      artifact: persisted.artifact,
      grant_quantity: 4800,
      events: { ipo: "2025-06-01", board: "2027-06-01" },
    });
    expect(both.start_to_apply).toEqual({ date: "2025-06-01" });
    expect(both.projection.length).toBeGreaterThan(0);
    expect(both.projection.reduce((a, e) => a + e.amount, 0)).toBe(4800);
    // The first tranche is the board-firing fold (24 months from ipo accrued).
    expect(both.projection[0].date).toBe("2027-06-01");
  });
});
