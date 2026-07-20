import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createServer } from "../src/server.js";
import { sourcePath } from "../scripts/resource-sources.js";

// The authoring recipe embeds each worked example's verify call as a paired
// `verify-input` / `verify-output` JSON fence. If the engine's numbers move, the
// page silently lies. This test replays every input through the real
// vestlang_verify_observations tool and checks the page's output block still
// matches — so the examples cannot drift from the tool they teach. The inputs
// under test ARE the page's own blocks, so input drift is caught by construction.
// Reads the source page, not the copy the server ships: a stale page has to fail.

// The page is static for the run, so read and parse it once.
const SOURCE = readFileSync(sourcePath("authoring"), "utf8");

type CallResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
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

const verify = (client: Client, args: Record<string, unknown>) =>
  client.callTool({
    name: "vestlang_verify_observations",
    arguments: args,
  }) as Promise<CallResult>;

// Pull the paired replay blocks out of the raw Markdown by their fence labels.
type Pair = { input?: unknown; output?: unknown };
function extractPairs(source: string): Map<string, Pair> {
  const re =
    /```json\s+verify-(input|output)=([A-Za-z0-9_-]+)[^\n]*\r?\n([\s\S]*?)\r?\n```/g;
  const pairs = new Map<string, Pair>();
  for (const m of source.matchAll(re)) {
    const [, side, label, body] = m;
    const pair = pairs.get(label) ?? {};
    pair[side as "input" | "output"] = JSON.parse(body);
    pairs.set(label, pair);
  }
  return pairs;
}

const PAIRS = extractPairs(SOURCE);

// Deep partial match: the output block asserts only the keys it declares. Objects
// compare declared keys only; arrays compare positionally and must be the same
// length as the tool's array; leaves are exact for booleans/strings/integers and
// within ±0.05 for non-integer numerics (so a block may round to one decimal).
function partialMatch(expected: unknown, actual: unknown, path: string): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path}: expected an array`).toBe(true);
    const arr = actual as unknown[];
    expect(arr.length, `${path}: array length`).toBe(expected.length);
    expected.forEach((e, i) => partialMatch(e, arr[i], `${path}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    expect(
      actual !== null && typeof actual === "object" && !Array.isArray(actual),
      `${path}: expected an object`,
    ).toBe(true);
    const obj = actual as Record<string, unknown>;
    const exp = expected as Record<string, unknown>;
    for (const key of Object.keys(exp)) {
      expect(
        Object.prototype.hasOwnProperty.call(obj, key),
        `${path}.${key}: missing in tool result`,
      ).toBe(true);
      partialMatch(exp[key], obj[key], `${path}.${key}`);
    }
    return;
  }
  if (typeof expected === "number" && !Number.isInteger(expected)) {
    expect(
      Math.abs((actual as number) - expected),
      `${path}: ${String(actual)} not within 0.05 of ${expected}`,
    ).toBeLessThanOrEqual(0.05);
    return;
  }
  expect(actual, path).toBe(expected);
}

describe("authoring recipe — replay blocks match the engine", () => {
  it("has at least three complete input/output pairs", () => {
    const complete = [...PAIRS.values()].filter(
      (p) => p.input !== undefined && p.output !== undefined,
    );
    expect(complete.length).toBeGreaterThanOrEqual(3);
  });

  for (const [label, pair] of PAIRS) {
    it(`${label}: the page's output block matches the tool result`, async () => {
      expect(pair.input, `${label}: missing input block`).toBeDefined();
      expect(pair.output, `${label}: missing output block`).toBeDefined();
      const client = await connectClient();
      const res = await verify(client, pair.input as Record<string, unknown>);
      expect(res.isError, `${label}: tool errored`).toBeFalsy();
      const out = res.structuredContent as Record<string, unknown>;
      expect(out.ok, `${label}: verify refused`).toBe(true);
      partialMatch(pair.output, out, label);
    });
  }
});

describe("authoring recipe — default tolerance in prose", () => {
  // The page states the default tolerance once, in prose. Read the number from
  // that sentence (not an output block) and hold it to the tolerance the engine
  // actually fills in when a verify call omits it — so the prose can't quote a
  // stale default. The engine's default is never re-hardcoded here.
  it("matches the tolerance the engine echoes when none is passed", async () => {
    const prose = SOURCE.replace(/```[\s\S]*?```/g, "");
    const m = prose.match(
      /default tolerance[^.]*?(\d+(?:\.\d+)?)\s*(?:percent|%)/i,
    );
    expect(
      m,
      "no 'default tolerance … N%' sentence in the prose",
    ).not.toBeNull();
    const stated = Number(m![1]);

    const noToleranceInput = [...PAIRS.values()]
      .map((p) => p.input as Record<string, unknown> | undefined)
      .find((i) => i !== undefined && i.tolerance === undefined);
    expect(
      noToleranceInput,
      "expected a replay input that omits tolerance",
    ).toBeDefined();

    const client = await connectClient();
    const res = await verify(client, noToleranceInput!);
    const out = res.structuredContent as Record<string, unknown>;
    const tolerance = out.tolerance as { kind: string; value: number };
    expect(tolerance.kind).toBe("percent");
    expect(stated).toBe(tolerance.value);
  });
});
