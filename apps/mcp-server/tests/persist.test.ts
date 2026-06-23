import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CONTINGENT_START_SENTINEL } from "@vestlang/primitives";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// End-to-end exercise of the persistence tool pair (vestlang_persist /
// vestlang_rehydrate) through the MCP boundary. The sidecar/rehydrate mechanics
// themselves live in @vestlang/evaluator; here we confirm the tools wire the
// pipeline up, shape the delta correctly, and surface the right error.

type CallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: { type: string; text: string }[];
};

async function connectClient(): Promise<Client> {
  const server = createServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

type PersistedArtifact = {
  template: { id: string; statements: unknown[] };
  runtime: {
    startDate?: string;
    grantDate?: string;
    eventFirings?: { event_id: string; date: string }[];
  };
  sidecar?: { vestlang: Record<string, { definition: string }> };
};

type PersistOutput = {
  artifact: PersistedArtifact;
  pending: Blocker[];
  dead: Blocker[];
};

type FiringToApply = {
  event_id: string;
  date: string;
  definition: string | null;
};
type StartToApply = { date: string };
type Blocker = { type: string; event?: string };
type RehydrateOutput = {
  firings_to_apply: FiringToApply[];
  start_to_apply: StartToApply | null;
  pending: Blocker[];
  dead: Blocker[];
  projection: { date: string; amount: number }[];
};

async function persist(
  client: Client,
  args: Record<string, unknown>,
): Promise<CallResult> {
  return (await client.callTool({
    name: "vestlang_persist",
    arguments: args,
  })) as CallResult;
}

// Persist and assert success, returning the structured output.
async function persistOk(
  client: Client,
  args: Record<string, unknown>,
): Promise<PersistOutput> {
  const res = await persist(client, args);
  expect(res.isError).toBeFalsy();
  return res.structuredContent as unknown as PersistOutput;
}

// Raw rehydrate call — does NOT assert success, so error and schema-rejection
// cases (a missing stored grant date, a now-removed param) can inspect isError.
async function rehydrateRaw(
  client: Client,
  args: Record<string, unknown>,
): Promise<CallResult> {
  return (await client.callTool({
    name: "vestlang_rehydrate",
    arguments: args,
  })) as CallResult;
}

async function rehydrate(
  client: Client,
  args: Record<string, unknown>,
): Promise<RehydrateOutput> {
  const res = await rehydrateRaw(client, args);
  expect(res.isError).toBeFalsy();
  return res.structuredContent as RehydrateOutput;
}

describe("mcp-server / persistence tool pair", () => {
  // A combinator start (EARLIER OF an event or a date) is a contingent start: it
  // lowers to a DATE-base template whose runtime.startDate is the contingent-start
  // sentinel, with the start's recipe externalized under the one reserved
  // `evt:start` sidecar key. So it persists WITH a sidecar.
  const COMBINATOR_DSL =
    "VEST FROM EARLIER OF (EVENT ipo, DATE 2027-01-01) OVER 48 months EVERY 1 month";

  it("persists a combinator start with a sidecar", async () => {
    const client = await connectClient();
    const res = await persist(client, {
      dsl: COMBINATOR_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });

    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as unknown as PersistOutput;
    // A storable template: the contingent start rides the sentinel startDate and
    // its recipe lives out-of-band under `evt:start`.
    expect(out.artifact.template.statements.length).toBeGreaterThan(0);
    expect(out.artifact.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(out.artifact.sidecar).toBeDefined();
    const sourceMap = out.artifact.sidecar!.vestlang;
    const ids = Object.keys(sourceMap);
    expect(ids).toEqual(["evt:start"]);
    expect(sourceMap["evt:start"].definition).toContain("ipo");
    // The gate hasn't fired, so the store-time blockers advise it's still pending —
    // surfaced under `pending`; nothing is dead here (no firing has contradicted
    // it). `dead` can be non-empty for a storable schedule once a recorded firing
    // dies a gate, but this combinator is clean.
    expect(out.pending.length).toBeGreaterThan(0);
    expect(out.dead).toEqual([]);
    // No synthetic witness yet — nothing has resolved.
    expect(out.artifact.runtime.eventFirings ?? []).toHaveLength(0);
  });

  // AC#8 — vestlang_persist's output is reshaped to pending/dead (no flat
  // `blockers`). Both these schedules are clean (no firing has died a gate), so
  // `dead` is []; a pending template surfaces its waiting witnesses in `pending`.
  // (`dead` is not universally [] for a storable schedule — a recorded firing can
  // die a gate — but these two cases carry none.)
  it("AC#8: persist returns pending/dead (no flat blockers); dead is [] for these clean templates", async () => {
    const client = await connectClient();

    // A pending template (combinator gate unfired): witnesses ride in `pending`.
    const pendingOut = await persistOk(client, {
      dsl: COMBINATOR_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });
    expect(pendingOut).toHaveProperty("pending");
    expect(pendingOut).toHaveProperty("dead");
    expect(pendingOut).not.toHaveProperty("blockers");
    expect(pendingOut.pending.length).toBeGreaterThan(0);
    expect(pendingOut.dead).toEqual([]);

    // A fully-dated template: nothing pending and nothing dead.
    const cleanOut = await persistOk(client, {
      dsl: "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month",
      grant_date: "2025-01-01",
      grant_quantity: 1200,
    });
    expect(cleanOut.pending).toEqual([]);
    expect(cleanOut.dead).toEqual([]);
  });

  it("rehydrating before the event fires yields no firings and pending blockers", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: COMBINATOR_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 1000,
    });

    // ipo hasn't fired; the EARLIER OF can't settle (open lower bound), so the
    // `evt:start` recipe doesn't resolve — no start to apply, nothing in the delta.
    expect(out.firings_to_apply).toEqual([]);
    expect(out.start_to_apply).toBeNull();
    expect(out.pending.length).toBeGreaterThan(0);
  });

  it("rehydrating after the event fires yields the dated start and projection", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: COMBINATOR_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 1000,
      events: { ipo: "2026-06-01" },
    });

    // The `evt:start` recipe now resolves; the EARLIER OF picks ipo (2026-06-01,
    // before the 2027 date), so the contingent start is re-derived to that date and
    // surfaced under `start_to_apply` — distinct from the (always-empty) runtime
    // witness delta. The start carries only its date, not a definition/event_id.
    expect(out.firings_to_apply).toEqual([]);
    expect(out.start_to_apply).toEqual({ date: "2026-06-01" });
    // Nothing left pending or dead once the start resolves, and the projection is
    // dated off the resolved start.
    expect(out.pending).toHaveLength(0);
    expect(out.dead).toHaveLength(0);
    expect(out.projection.length).toBe(48);
    expect(out.projection[0].date).toBe("2026-07-01");
    const total = out.projection.reduce((s, i) => s + i.amount, 0);
    expect(total).toBe(1000);
  });

  it("persists a plain time-based template with NO sidecar and rehydrates cleanly", async () => {
    const client = await connectClient();
    const res = await persist(client, {
      dsl: "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month",
      grant_date: "2025-01-01",
      grant_quantity: 1200,
    });
    expect(res.isError).toBeFalsy();
    const persisted = res.structuredContent as unknown as PersistOutput;
    // No synthetic events, so nothing to carry out-of-band.
    expect(persisted.artifact.sidecar).toBeUndefined();
    expect(persisted.pending).toHaveLength(0);
    expect(persisted.dead).toEqual([]);

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 1200,
    });
    // A dropped/absent sidecar means no contingent start to re-derive — empty delta,
    // no start to apply — but the time-based projection still compiles.
    expect(out.firings_to_apply).toEqual([]);
    expect(out.start_to_apply).toBeNull();
    expect(out.pending).toHaveLength(0);
    expect(out.projection.length).toBe(48);
    const total = out.projection.reduce((s, i) => s + i.amount, 0);
    expect(total).toBe(1200);
  });

  // A bare named EVENT start (`VEST FROM EVENT ipo …`) is a contingent start: it
  // lowers to a DATE-base template on the sentinel startDate, with its `EVENT ipo`
  // recipe externalized under the reserved `evt:start` sidecar key. The event is
  // the schedule's whole dependency; rehydrate re-derives the start by resolving
  // that recipe, surfacing it under `start_to_apply`.
  const BARE_EVENT_DSL =
    "VEST FROM EVENT ipo OVER 4 months EVERY 1 month CLIFF +2 months";

  it("rehydrating a bare EVENT before it fires discloses it as pending", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
    });
    // The contingent start's recipe rides the `evt:start` sidecar.
    expect(persisted.artifact.sidecar!.vestlang["evt:start"].definition).toBe(
      "EVENT ipo",
    );

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 400,
    });

    // ipo hasn't fired, so the start can't be re-derived and nothing projects — but
    // it must be disclosed as pending (the disclosure-symptom regression: pre-fix
    // `pending` was []).
    expect(out.firings_to_apply).toEqual([]);
    expect(out.start_to_apply).toBeNull();
    expect(out.projection).toHaveLength(0);
    expect(out.pending.length).toBeGreaterThan(0);
    expect(
      out.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });

  it("rehydrating a bare EVENT after it fires yields its start and projection", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
    });

    const out = await rehydrate(client, {
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
    expect(out.pending).toHaveLength(0);
    // ipo's firing re-derives the contingent start, surfaced under `start_to_apply`
    // (just its date — no definition/event_id). The runtime witness delta is empty.
    expect(out.firings_to_apply).toEqual([]);
    expect(out.start_to_apply).toEqual({ date: "2025-01-31" });
  });

  it("AC#8: persist is firing-invariant — a firing supplied at persist is NOT baked; reload without resupply is pending", async () => {
    const client = await connectClient();
    // Persist WITH the firing. The artifact is built from the firing-invariant
    // interchange, so the firing is NOT stored (Decision 7 reversal): the runtime
    // carries no eventFirings, byte-identical to persisting without the firing.
    const withFiring = await persistOk(client, {
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
      events: { ipo: "2025-01-31" },
    });
    expect(withFiring.artifact.runtime.eventFirings ?? []).toHaveLength(0);

    const withoutFiring = await persistOk(client, {
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
    });
    // Same artifact either way — firing-invariant by construction.
    expect(withFiring.artifact).toEqual(withoutFiring.artifact);

    // Reload WITHOUT re-supplying ipo → it reports pending (the firing was never
    // baked, so there is nothing to stand on).
    const reloadBlind = await rehydrate(client, {
      artifact: withFiring.artifact,
      grant_quantity: 400,
      // events omitted.
    });
    expect(reloadBlind.projection).toHaveLength(0);
    expect(reloadBlind.start_to_apply).toBeNull();
    expect(
      reloadBlind.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);

    // Re-supplying ipo re-derives the contingent start from the world → full
    // projection, with the start surfaced under `start_to_apply`.
    const reloadFired = await rehydrate(client, {
      artifact: withFiring.artifact,
      grant_quantity: 400,
      events: { ipo: "2025-01-31" },
    });
    expect(reloadFired.projection).toEqual([
      { date: "2025-03-31", amount: 200 },
      { date: "2025-04-30", amount: 100 },
      { date: "2025-05-31", amount: 100 },
    ]);
    expect(reloadFired.pending).toHaveLength(0);
    expect(reloadFired.firings_to_apply).toEqual([]);
    expect(reloadFired.start_to_apply).toEqual({ date: "2025-01-31" });
  });

  it("a corrected firing on rehydrate overrides the stored bare EVENT date", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
      events: { ipo: "2025-01-31" },
    });

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 400,
      events: { ipo: "2025-02-28" },
    });

    // The supplied firing re-derives the contingent start at the corrected date, so
    // the schedule shifts a month.
    expect(out.projection).toEqual([
      { date: "2025-04-28", amount: 200 },
      { date: "2025-05-28", amount: 100 },
      { date: "2025-06-28", amount: 100 },
    ]);
    expect(out.firings_to_apply).toEqual([]);
    expect(out.start_to_apply).toEqual({ date: "2025-02-28" });
  });

  it("returns a clear error when the program is not a single template", async () => {
    const client = await connectClient();
    // Two independent absolute-date grids can't be one canonical template (a record
    // keeper models them as separate grants), so this resolves to events-only.
    const res = await persist(client, {
      dsl:
        "1/2 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 12 months " +
        "PLUS 1/2 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 12 months",
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      ok: boolean;
      error: { ruleId: string; message: string };
    };
    expect(sc.ok).toBe(false);
    expect(sc.error.ruleId).toBe("persist-not-storable");
    expect(sc.error.message).toContain("template");
  });

  it("refuses an over-allocating single template, naming the over-allocation", async () => {
    const client = await connectClient();
    // 6000 shares vest on a 4800-share grant — 125%. The resolution is a clean single
    // template, so the old shape gate alone would have let it through; the validity
    // gate is what now catches it. Without the fix this persists ok: true and the
    // rehydrated projection over-vests the grant.
    const res = await persist(client, {
      dsl: "6000 VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      ok: boolean;
      error: { ruleId: string; message: string };
    };
    expect(sc.ok).toBe(false);
    expect(sc.error.ruleId).toBe("persist-not-storable");
    expect(sc.error.message).toMatch(/over-allocat/);
  });

  it("still persists an under-allocating program", async () => {
    const client = await connectClient();
    // Below 100% (here 50%) is legal — leaving shares unvested is allowed. It carries
    // a warning-severity under-allocation finding, so it exercises the severity gate:
    // warnings pass where errors don't, which an exactly-100% program wouldn't prove.
    const res = await persist(client, {
      dsl: "1/2 VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS",
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });

    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as unknown as PersistOutput;
    expect(out.artifact.template.statements.length).toBeGreaterThan(0);
  });

  it("reports a PLUS over-allocation as the over-allocation, not the shape", async () => {
    const client = await connectClient();
    // 1/2 PLUS 3/4 sums to 5/4 — over-allocation — and also resolves events-only, so
    // it would have tripped the shape gate incidentally. Validity is checked first, so
    // the refusal now names the real defect rather than the status.
    const res = await persist(client, {
      dsl: "1/2 VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS PLUS 3/4 VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS",
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      ok: boolean;
      error: { ruleId: string; message: string };
    };
    expect(sc.ok).toBe(false);
    expect(sc.error.ruleId).toBe("persist-not-storable");
    expect(sc.error.message).toMatch(/over-allocat/);
  });

  it("refuses a statically-dead date window the linter calls an error", async () => {
    const client = await connectClient();
    // The gate "after 2026-01-01 AND before 2025-01-01" is an empty window: no
    // firing can satisfy both. The linter flags it (unsatisfiable-date-window,
    // error), but the gated event lowers to a synthetic that resolves to a
    // template when no events are read — so without the lint gate this persists
    // ok: true, minting a statically-dead artifact. The gate must turn it away.
    const res = await persist(client, {
      dsl: "VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      ok: boolean;
      error: { ruleId: string; message: string };
    };
    expect(sc.ok).toBe(false);
    expect(sc.error.ruleId).toBe("persist-not-storable");
    expect(sc.error.message).toMatch(/unsatisfiable-date-window/);
  });

  it("persists a warning-only program (a warning does not block storage)", async () => {
    const client = await connectClient();
    // CLIFF 2 YEARS over a 1-year grid trips cliff-exceeds-span — a *warning*,
    // advisory only — yet still resolves to a single storable template. The gate
    // keys on error severity, so a warned-but-legal schedule stays storable.
    const res = await persist(client, {
      dsl: "VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS CLIFF 2 YEARS",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });

    expect(res.isError).toBeFalsy();
    const out = res.structuredContent as unknown as PersistOutput;
    expect(out.artifact.template.statements.length).toBeGreaterThan(0);
  });

  // ---- Issue #229 / #253: the grant's frozen conventions come from the artifact ----
  //
  // An offset contingent start gated on `ipo`. The start re-resolves EXACT (#253) —
  // a displacement keeps its day, clamping on a short month, never snapping to the
  // stored fixed-day rule. What the stored rule still governs is the projection
  // GRID, which re-snaps off that start. So this pins that the rule lives in the
  // artifact and shows up in the grid, with the re-derived start exact.
  const OFFSET_SYNTHETIC_DSL =
    "VEST FROM EVENT ipo + 1 month OVER 4 MONTHS EVERY 1 MONTH";

  it("exact start, projection grid snaps under the stored day-of-month rule", async () => {
    const client = await connectClient();
    // Persist under rule "15" — non-default, so the rule is frozen into the runtime.
    const persisted = await persistOk(client, {
      dsl: OFFSET_SYNTHETIC_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
      vesting_day_of_month: "15",
    });

    // Rehydrate with no day-of-month arg (it no longer exists) — ipo on a month-end.
    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 400,
      events: { ipo: "2025-01-31" },
    });

    // The re-derived start is the EXACT offset (#253): ipo on Jan 31 + 1 month keeps
    // day 31 and clamps to Feb's last day (2025-02-28) — a displacement never
    // consults the "15" policy. The projection GRID still re-snaps to the 15th off
    // that start, so the stored rule shows up there, not in the start date.
    expect(out.start_to_apply).toEqual({ date: "2025-02-28" });
    expect(out.projection[0].date).toBe("2025-03-15");
    expect(out.projection).toEqual([
      { date: "2025-03-15", amount: 100 },
      { date: "2025-04-15", amount: 100 },
      { date: "2025-05-15", amount: 100 },
      { date: "2025-06-15", amount: 100 },
    ]);
  });

  it("default-rule agreement: start and projection share the firing-date origin", async () => {
    const client = await connectClient();
    // No vesting_day_of_month — the default rule, so runtime.vestingDayOfMonth is
    // absent and rehydrate re-applies the same default the projection compiles under.
    const persisted = await persistOk(client, {
      dsl: OFFSET_SYNTHETIC_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
    });
    expect(
      (persisted.artifact.runtime as { vestingDayOfMonth?: string })
        .vestingDayOfMonth,
    ).toBeUndefined();

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 400,
      events: { ipo: "2025-01-31" },
    });

    // +1 month off a month-end, under the default rule, lands on the month-end.
    // The re-derived start origin (2025-02-28) is what the projection grid anchors on.
    expect(out.start_to_apply).toEqual({ date: "2025-02-28" });
    expect(out.projection[0].date).toBe("2025-03-28");
    expect(out.projection).toEqual([
      { date: "2025-03-28", amount: 100 },
      { date: "2025-04-28", amount: 100 },
      { date: "2025-05-28", amount: 100 },
      { date: "2025-06-28", amount: 100 },
    ]);
  });

  it("no longer accepts grant_date, vesting_day_of_month, or as_of (schema + description)", async () => {
    const client = await connectClient();

    // The registered tool drops these params from its strict input schema and its
    // description no longer mentions them. `as_of` was inert all the way to this
    // public surface — it fed a context field nobody read — so it's removed (AC#8).
    const { tools } = await client.listTools();
    const rehydrateTool = tools.find((t) => t.name === "vestlang_rehydrate");
    expect(rehydrateTool).toBeDefined();
    const props = (
      rehydrateTool!.inputSchema as { properties?: Record<string, unknown> }
    ).properties;
    expect(props).toBeDefined();
    expect(props).not.toHaveProperty("grant_date");
    expect(props).not.toHaveProperty("vesting_day_of_month");
    expect(props).not.toHaveProperty("as_of");
    expect(rehydrateTool!.description ?? "").not.toMatch(/grant_date/);
    expect(rehydrateTool!.description ?? "").not.toMatch(
      /vesting_day_of_month/,
    );
    expect(rehydrateTool!.description ?? "").not.toMatch(/as_of/);

    // A call supplying only the surviving params succeeds.
    const persisted = await persistOk(client, {
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
    });
    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 400,
      events: { ipo: "2025-01-31" },
    });
    expect(out.projection.length).toBeGreaterThan(0);
  });

  it("grant_quantity is still required and still sizes the projection", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: "VEST FROM DATE 2025-01-01 OVER 4 months EVERY 1 month",
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });

    // Omitting grant_quantity is rejected by the strict schema.
    const missing = await rehydrateRaw(client, {
      artifact: persisted.artifact,
    });
    expect(missing.isError).toBe(true);

    // Supplied, it sizes the projection to that total.
    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 800,
    });
    const total = out.projection.reduce((s, i) => s + i.amount, 0);
    expect(total).toBe(800);

    // A different quantity resizes it — proof it's the caller's input, not stored.
    const out2 = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 1200,
    });
    expect(out2.projection.reduce((s, i) => s + i.amount, 0)).toBe(1200);
  });

  it("errors clearly when the artifact has no stored grant date", async () => {
    const client = await connectClient();
    // A hand-built artifact whose runtime omits grantDate — can't come from persist,
    // which always stores it. Without the guard, the missing date would silently
    // re-resolve everything against undefined.
    const artifact = {
      template: {
        id: "t1",
        statements: [
          {
            order: 0,
            occurrences: 4,
            period: 1,
            period_type: "MONTHS",
            percentage: "1",
          },
        ],
      },
      runtime: {
        startDate: "2025-01-01",
        // grantDate deliberately absent
      },
    };

    const res = await rehydrateRaw(client, {
      artifact,
      grant_quantity: 400,
    });

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      ok: boolean;
      error: { ruleId: string; message: string };
    };
    expect(sc.ok).toBe(false);
    expect(sc.error.ruleId).toBe("rehydrate-missing-grant-date");
    expect(sc.error.message).toMatch(/grant date/i);
  });

  // Issue #296 / #345 — unifying the orchestrators onto a structured
  // PipelineError, and now the wire envelope, must NOT change a single
  // operator-facing byte. Under #345 persist/rehydrate refusals ride the wire as
  // { ok: false, error } (no longer the MCP `isError` channel), so the message a
  // tool consumer reads is on `structuredContent.error.message` — and it is
  // exactly what it was before. The baselines below are frozen literal strings.
  it("AC#5/#345: rehydrate's missing-grant-date refusal message is byte-stable", async () => {
    const client = await connectClient();
    const res = await rehydrateRaw(client, {
      artifact: {
        template: { id: "t1", statements: [] },
        runtime: { startDate: "2025-01-01" },
      },
      grant_quantity: 400,
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      ok: boolean;
      error: { ruleId: string; message: string };
    };
    expect(sc.ok).toBe(false);
    expect(sc.error.ruleId).toBe("rehydrate-missing-grant-date");
    expect(sc.error.message).toBe(
      "Cannot rehydrate: the artifact's runtime is missing its stored grant date (runtime.grantDate). A persisted artifact always carries it; supply one built by vestlang_persist.",
    );
  });

  it("AC#5/#345: persist's non-template refusal message is byte-stable", async () => {
    const client = await connectClient();
    // Two independent date grids → events-only (an event cliff stores as a template
    // now, so it no longer witnesses a non-template refusal).
    const res = await persist(client, {
      dsl:
        "1/2 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 12 months " +
        "PLUS 1/2 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 12 months",
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      ok: boolean;
      error: { ruleId: string; message: string };
    };
    expect(sc.ok).toBe(false);
    expect(sc.error.ruleId).toBe("persist-not-storable");
    expect(sc.error.message).toBe(
      'Only a single-template program is storable as a persisted artifact; this program\'s storable form is "events-only". Adjust the schedule so it collapses to a single canonical template.',
    );
  });

  // ---- Issue #230: dead blockers split out of `pending` ----
  //
  // A windowed gate: ipo must fire strictly inside (2026-01-01, 2026-06-01). It's a
  // satisfiable window — lint lets it persist — so the artifact stores a synthetic
  // gate. The bug class shows up at rehydrate time: fire ipo OUTSIDE the window and
  // the gate is contradicted (dead), but the evaluator returns it in the same flat
  // list as genuinely-waiting gates.
  //
  // After #291 these cases also serve as the AC#7 regression guard: the pending/dead
  // split now originates in the evaluator (`partitionResolutionBlockers`) and rehydrate
  // consumes the typed `pending`/`dead` directly — no `filter(isImpossibleBlocker)` at
  // the MCP boundary — so these still passing proves the re-expressed partition holds.
  const WINDOWED_GATE_DSL =
    "VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2026-06-01 OVER 1 YEAR EVERY 3 MONTHS";

  const isImpossible = (b: Blocker): boolean =>
    b.type.startsWith("IMPOSSIBLE_");

  it("files a dead gate under `dead`, not `pending`, when its event fires outside the window", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: WINDOWED_GATE_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });

    // ipo fires in 2027 — past the BEFORE 2026-06-01 bound — so the gate can never
    // resolve. Pre-fix this rode in `pending`, telling an operator to keep waiting.
    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 4800,
      events: { ipo: "2027-01-01" },
    });

    expect(out.dead.length).toBeGreaterThan(0);
    expect(out.dead.some((b) => b.type === "IMPOSSIBLE_CONDITION")).toBe(true);
    expect(out.pending).toHaveLength(0);
  });

  it("keeps a genuinely-waiting bare EVENT gate in `pending`, with `dead` empty", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
    });

    // ipo hasn't fired at all, so the gate is still waiting — not dead.
    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 400,
    });

    expect(out.pending.length).toBeGreaterThan(0);
    expect(out.pending.every((b) => !isImpossible(b))).toBe(true);
    expect(
      out.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
    expect(out.dead).toHaveLength(0);
  });

  it("keeps a genuinely-waiting combinator gate in `pending`, with `dead` empty", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: COMBINATOR_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });

    // ipo hasn't fired; the EARLIER OF can't settle yet — still waiting, not dead.
    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 1000,
    });

    expect(out.pending.length).toBeGreaterThan(0);
    // For the combinator we assert only that nothing is dead — the selector's exact
    // blocker shape is the evaluator's concern, out of scope here.
    expect(out.pending.every((b) => !isImpossible(b))).toBe(true);
    expect(out.dead).toHaveLength(0);
  });

  it("always includes `dead` ([] for a clean time-based template)", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month",
      grant_date: "2025-01-01",
      grant_quantity: 1200,
    });

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 1200,
    });

    // No gate at all, so nothing pending and nothing dead — but `dead` is present.
    expect(out).toHaveProperty("dead");
    expect(out.dead).toEqual([]);
    expect(out.pending).toEqual([]);
  });

  it("never lists the same blocker in both `pending` and `dead`", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: WINDOWED_GATE_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_quantity: 4800,
      events: { ipo: "2027-01-01" },
    });

    // The partition is disjoint: every dead blocker is impossible, every pending one
    // isn't, so no object can appear on both sides.
    expect(out.dead.every(isImpossible)).toBe(true);
    expect(out.pending.every((b) => !isImpossible(b))).toBe(true);
    const overlap = out.pending.filter((p) =>
      out.dead.some((d) => JSON.stringify(d) === JSON.stringify(p)),
    );
    expect(overlap).toHaveLength(0);
  });

  it("documents `dead` and points `pending` at the separate reporting", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const rehydrateTool = tools.find((t) => t.name === "vestlang_rehydrate");
    expect(rehydrateTool).toBeDefined();
    const description = rehydrateTool!.description ?? "";

    // A documented `dead` clause, and a `pending` clause that names where dead arms
    // are reported instead.
    expect(description).toMatch(/dead/);
    expect(description).toMatch(/`pending`[\s\S]*\bdead\b/i);
    expect(description).toMatch(/separately/i);
  });

  // ---- Issue #231: corrupt sidecar refused cleanly; stored dates calendar-checked
  //
  // The persisted artifact is untrusted input — it may live in external storage and
  // be hand-edited. Two boundary failures must be handled here rather than crashing
  // deep in core: a corrupt event definition, and an impossible calendar date.

  // A stored contingent-start artifact whose `evt:start` recipe is corrupt. The
  // template is DATE-base on the contingent-start sentinel, with the (now garbage)
  // recipe under the one reserved `evt:start` key, so rehydrate actually reparses it.
  // A non-reserved key would trip the namespace guard before any reparse. Every
  // structural field is calendar-valid so the schema admits it and the failure
  // surfaces at reparse.
  const corruptArtifact = (eventId: string, definition: string) => ({
    template: {
      id: "t1",
      statements: [
        {
          order: 1,
          occurrences: 4,
          period: 1,
          period_type: "MONTHS",
          percentage: "1",
        },
      ],
    },
    runtime: { grantDate: "2025-01-01", startDate: CONTINGENT_START_SENTINEL },
    sidecar: { vestlang: { [eventId]: { definition } } },
  });

  it("refuses a corrupt sidecar recipe, naming the reserved key and not leaking the parser dump", async () => {
    const client = await connectClient();

    const res = await rehydrateRaw(client, {
      artifact: corruptArtifact("evt:start", "TOTALLY NOT DSL (("),
      grant_quantity: 400,
    });

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      ok: boolean;
      error: { ruleId: string; message: string };
    };
    expect(sc.ok).toBe(false);
    expect(sc.error.ruleId).toBe("rehydrate-corrupt-definition");
    const text = sc.error.message;
    // Names the offending reserved key and reads as an intentional corruption refusal.
    expect(text).toContain("evt:start");
    expect(text).toMatch(/corrupt|unparseable/i);
    // The raw peggy dump stays on the error's `cause`, never in the operator message.
    expect(text).not.toContain('Expected "DATE"');
  });

  // The artifact schema's date fields must get the same real-calendar check the live
  // tool inputs already enforce — single-sourced from one ISO_DATE. Pin both stored
  // runtime date sites so a partial swap can't pass: a regex-only schema would
  // accept these lexically-shaped impossibles and only die deep inside core.
  it("rejects an impossible runtime.grantDate at the schema boundary", async () => {
    const client = await connectClient();
    const res = await rehydrateRaw(client, {
      artifact: {
        template: { id: "t1", statements: [] },
        runtime: { grantDate: "2025-02-31" },
      },
      grant_quantity: 400,
    });
    expect(res.isError).toBe(true);
  });

  it("rejects an impossible runtime.startDate at the schema boundary", async () => {
    const client = await connectClient();
    const res = await rehydrateRaw(client, {
      artifact: {
        template: { id: "t1", statements: [] },
        runtime: { grantDate: "2025-01-01", startDate: "2025-13-01" },
      },
      grant_quantity: 400,
    });
    expect(res.isError).toBe(true);
  });

  // AC#15: firing-invariance is enforced on the wire. A stored runtime is
  // StoredTerms — eventFirings is unrepresentable — so the strict RUNTIME schema
  // rejects an artifact that tries to bake a firing in (a hand-edit smuggling one),
  // not merely at the type level.
  it("rejects a runtime carrying eventFirings at the schema boundary", async () => {
    const client = await connectClient();
    const res = await rehydrateRaw(client, {
      artifact: {
        template: { id: "t1", statements: [] },
        runtime: {
          grantDate: "2025-01-01",
          eventFirings: [{ event_id: "ipo", date: "2025-01-31" }],
        },
      },
      grant_quantity: 400,
    });
    expect(res.isError).toBe(true);
  });
});
