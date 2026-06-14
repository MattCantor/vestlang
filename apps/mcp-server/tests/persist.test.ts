import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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
  runtime: { eventFirings?: { event_id: string; date: string }[] };
  sidecar?: { vestlang: Record<string, { definition: string }> };
};

type PersistOutput = { artifact: PersistedArtifact; blockers: unknown[] };

type FiringToApply = {
  event_id: string;
  date: string;
  definition: string | null;
};
type RehydrateOutput = {
  firings_to_apply: FiringToApply[];
  pending: unknown[];
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

async function rehydrate(
  client: Client,
  args: Record<string, unknown>,
): Promise<RehydrateOutput> {
  const res = (await client.callTool({
    name: "vestlang_rehydrate",
    arguments: args,
  })) as CallResult;
  expect(res.isError).toBeFalsy();
  return res.structuredContent as RehydrateOutput;
}

describe("mcp-server / persistence tool pair", () => {
  // A combinator start (EARLIER OF an event or a date) lowers to a template with a
  // synthetic event, so it persists WITH a sidecar.
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
    // A storable template with the synthetic event carried out-of-band.
    expect(out.artifact.template.statements.length).toBeGreaterThan(0);
    expect(out.artifact.sidecar).toBeDefined();
    const sourceMap = out.artifact.sidecar!.vestlang;
    const ids = Object.keys(sourceMap);
    expect(ids).toHaveLength(1);
    expect(sourceMap[ids[0]].definition).toContain("ipo");
    // The gate hasn't fired, so the store-time blockers advise it's still pending.
    expect(out.blockers.length).toBeGreaterThan(0);
    // No synthetic witness yet — nothing has resolved.
    expect(out.artifact.runtime.eventFirings ?? []).toHaveLength(0);
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
      grant_date: "2025-01-01",
      grant_quantity: 1000,
      as_of: "2026-01-01",
    });

    // ipo hasn't fired; the EARLIER OF can't settle (open lower bound), so no
    // synthetic witness resolves and nothing is added to the action list.
    expect(out.firings_to_apply).toHaveLength(0);
    expect(out.pending.length).toBeGreaterThan(0);
  });

  it("rehydrating after the event fires yields the dated delta and projection", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: COMBINATOR_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
      events: { ipo: "2026-06-01" },
      as_of: "2026-07-01",
    });

    // The synthetic id now resolves; the EARLIER OF picks ipo (2026-06-01, before
    // the 2027 date), so the delta carries the synthetic id at that date, with the
    // human-readable definition looked up from the sidecar.
    expect(out.firings_to_apply).toHaveLength(1);
    const firing = out.firings_to_apply[0];
    expect(firing.date).toBe("2026-06-01");
    expect(firing.definition).toContain("ipo");
    expect(firing.event_id).toBe(
      Object.keys(persisted.artifact.sidecar!.vestlang)[0],
    );
    // Nothing left pending, and the projection is dated off the resolved witness.
    expect(out.pending).toHaveLength(0);
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
    expect(persisted.blockers).toHaveLength(0);

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_date: "2025-01-01",
      grant_quantity: 1200,
      as_of: "2026-01-01",
    });
    // A dropped/absent sidecar resolves no synthetic witnesses — empty delta — but
    // the time-based projection still compiles.
    expect(out.firings_to_apply).toHaveLength(0);
    expect(out.pending).toHaveLength(0);
    expect(out.projection.length).toBe(48);
    const total = out.projection.reduce((s, i) => s + i.amount, 0);
    expect(total).toBe(1200);
  });

  // A bare named EVENT start (`VEST FROM EVENT ipo …`) lowers to a plain EVENT
  // statement — the template names `ipo` in `vesting_base`, with no sidecar. The
  // event is the schedule's whole dependency; rehydrate must read it off the
  // template, not the (absent) sidecar.
  const BARE_EVENT_DSL =
    "VEST FROM EVENT ipo OVER 4 months EVERY 1 month CLIFF +2 months";

  it("rehydrating a bare EVENT before it fires discloses it as pending", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
    });
    // The bare event lives in the template, not a sidecar.
    expect(persisted.artifact.sidecar).toBeUndefined();

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_date: "2025-01-01",
      grant_quantity: 400,
    });

    // ipo hasn't fired, so nothing projects — but it must be disclosed as pending
    // (the disclosure-symptom regression: pre-fix `pending` was []).
    expect(out.firings_to_apply).toHaveLength(0);
    expect(out.projection).toHaveLength(0);
    expect(out.pending.length).toBeGreaterThan(0);
    const pending = out.pending as { type: string; event?: string }[];
    expect(
      pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });

  it("rehydrating a bare EVENT after it fires yields its witness and projection", async () => {
    const client = await connectClient();
    const persisted = await persistOk(client, {
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
    });

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_date: "2025-01-01",
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
    // The firing is a genuine delta against the empty stored runtime, reported with
    // `definition: null` — it's the caller's own named event, not a minted gate.
    expect(out.firings_to_apply).toEqual([
      { event_id: "ipo", date: "2025-01-31", definition: null },
    ]);
  });

  it("rehydrating an already-fired bare EVENT without re-supplying it keeps the stored firing", async () => {
    const client = await connectClient();
    // Persist WITH the firing, so the stored runtime already carries it.
    const persisted = await persistOk(client, {
      dsl: BARE_EVENT_DSL,
      grant_date: "2025-01-01",
      grant_quantity: 400,
      events: { ipo: "2025-01-31" },
    });
    expect(persisted.artifact.runtime.eventFirings).toEqual([
      { event_id: "ipo", date: "2025-01-31" },
    ]);

    const out = await rehydrate(client, {
      artifact: persisted.artifact,
      grant_date: "2025-01-01",
      grant_quantity: 400,
      // events omitted — the firing was recorded at persist.
    });

    // The stored firing stands: full projection, nothing pending (the !firings.has
    // guard — without it the bare loop would spuriously report ipo pending while it
    // still vests), and no delta since the firing is unchanged.
    expect(out.projection).toEqual([
      { date: "2025-03-31", amount: 200 },
      { date: "2025-04-30", amount: 100 },
      { date: "2025-05-31", amount: 100 },
    ]);
    expect(out.pending).toHaveLength(0);
    expect(out.firings_to_apply).toHaveLength(0);
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
      grant_date: "2025-01-01",
      grant_quantity: 400,
      events: { ipo: "2025-02-28" },
    });

    // The supplied firing overrides the seed, so the schedule shifts a month.
    expect(out.projection).toEqual([
      { date: "2025-04-28", amount: 200 },
      { date: "2025-05-28", amount: 100 },
      { date: "2025-06-28", amount: 100 },
    ]);
    expect(out.firings_to_apply).toEqual([
      { event_id: "ipo", date: "2025-02-28", definition: null },
    ]);
  });

  it("returns a clear error when the program is not a single template", async () => {
    const client = await connectClient();
    // An event-anchored cliff can't be expressed as one canonical template — the
    // cliff is duration-only — so this resolves to something non-storable.
    const res = await persist(client, {
      dsl: "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month CLIFF EVENT ipo",
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });

    expect(res.isError).toBe(true);
    const text = res.content?.[0]?.text ?? "";
    expect(text).toContain("template");
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

    expect(res.isError).toBe(true);
    const text = res.content?.[0]?.text ?? "";
    expect(text).toMatch(/over-allocat/);
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

    expect(res.isError).toBe(true);
    const text = res.content?.[0]?.text ?? "";
    expect(text).toMatch(/over-allocat/);
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

    expect(res.isError).toBe(true);
    const text = res.content?.[0]?.text ?? "";
    expect(text).toMatch(/unsatisfiable-date-window/);
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
});
