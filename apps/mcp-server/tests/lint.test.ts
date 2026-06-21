import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// vestlang_lint reports the domain flag `errorFree` (gates on error severity —
// valid/storable, matching vestlang_persist) and `clean` (true only with no
// diagnostics at all). A warning leaves `errorFree: true`, `clean: false` — it's
// advisory. This guards that split against the any-diagnostic gating the tool
// used to carry (issue #331). The top-level `ok` is the universal envelope flag
// (#345): always true here, since lint never refuses — distinct from `errorFree`.

type CallResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};

type Diagnostic = { ruleId: string; severity: string; message: string };
type LintResult = {
  ok: boolean;
  errorFree: boolean;
  clean: boolean;
  diagnostics: Diagnostic[];
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

async function lint(dsl: string): Promise<LintResult> {
  const client = await connectClient();
  const res = (await client.callTool({
    name: "vestlang_lint",
    arguments: { dsl },
  })) as CallResult;
  expect(res.isError).toBeFalsy();
  return res.structuredContent as LintResult;
}

describe("mcp-server / vestlang_lint errorFree+clean gating (#331, #345)", () => {
  it("a clean program is errorFree and clean with no diagnostics", async () => {
    const sc = await lint(
      "VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month",
    );
    expect(sc.ok).toBe(true); // envelope: the call answered
    expect(sc.errorFree).toBe(true);
    expect(sc.clean).toBe(true);
    expect(sc.diagnostics).toHaveLength(0);
  });

  it("a warning-only program is errorFree but not clean (advisory)", async () => {
    const sc = await lint("1/2 VEST OVER 12 months EVERY 1 month");
    expect(sc.ok).toBe(true); // envelope: the call answered
    expect(sc.errorFree).toBe(true);
    expect(sc.clean).toBe(false);
    expect(sc.diagnostics).toHaveLength(1);
    expect(sc.diagnostics[0].ruleId).toBe("portion-allocation");
  });

  it("an error program is neither errorFree nor clean (but the call still answers)", async () => {
    const sc = await lint(
      "VEST FROM EVENT x AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 48 months EVERY 1 month",
    );
    expect(sc.ok).toBe(true); // envelope: lint never refuses
    expect(sc.errorFree).toBe(false);
    expect(sc.clean).toBe(false);
    expect(sc.diagnostics).toHaveLength(1);
    expect(sc.diagnostics[0].ruleId).toBe("unsatisfiable-date-window");
  });
});

describe("mcp-server / vestlang_lint description (#331)", () => {
  it("documents both flags and the advisory non-error diagnostics", async () => {
    const server = createServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const { tools } = await client.listTools();
    const description =
      tools.find((t) => t.name === "vestlang_lint")?.description ?? "";

    expect(description).toContain("clean");
    expect(description).toContain("advisory");
    expect(description).not.toMatch(/empty.*diagnostics.*array.*means.*valid/i);
  });
});
