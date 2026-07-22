import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StreamableHTTPServerTransportOptions } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent, request as nodeRequest } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { startHttpServer, type HttpConfig } from "../src/http.js";

// Counting the transports the HTTP layer builds and closes. Two concurrent
// clients sharing one transport would collide on JSON-RPC ids, and every tool
// here is synchronous CPU work in a single-threaded process — so two POSTs
// serialize and matching ids alone would prove nothing. Identity is the evidence.
const transports = vi.hoisted(() => {
  const constructed: object[] = [];
  const closed = new Set<object>();
  return {
    constructed,
    closed,
    reset(): void {
      constructed.length = 0;
      closed.clear();
    },
  };
});

vi.mock(
  "@modelcontextprotocol/sdk/server/streamableHttp.js",
  async (original) => {
    const actual =
      await original<
        typeof import("@modelcontextprotocol/sdk/server/streamableHttp.js")
      >();
    class InstrumentedTransport extends actual.StreamableHTTPServerTransport {
      constructor(options?: StreamableHTTPServerTransportOptions) {
        super(options);
        transports.constructed.push(this);
      }
      override async close(): Promise<void> {
        transports.closed.add(this);
        await super.close();
      }
    }
    return { ...actual, StreamableHTTPServerTransport: InstrumentedTransport };
  },
);

const HOST = "127.0.0.1";
const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

const initialize = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "http-transport-test", version: "0.0.0" },
  },
});

const lintCall = (id: number, dsl: string) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "vestlang_lint", arguments: { dsl } },
});

let running:
  | { port: number; server: Server; shutdown: () => Promise<void> }
  | undefined;

async function boot(config: Partial<HttpConfig> = {}): Promise<number> {
  // Port 0: the OS picks a free one, so parallel suites never collide.
  const { server, shutdown } = await startHttpServer({
    port: 0,
    host: HOST,
    ...config,
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("server did not bind a port");
  }
  running = { port: address.port, server, shutdown };
  return address.port;
}

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A raw request, so tests can set a Host header and read one back. */
function raw(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  agent?: Agent;
  /** Give up on the reply and destroy the socket — a client that walks away. */
  abort?: boolean;
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = nodeRequest(
      {
        host: HOST,
        port: options.port,
        method: options.method,
        path: options.path,
        headers: options.headers,
        agent: options.agent,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
          }),
        );
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
    if (options.abort) {
      setImmediate(() => {
        req.destroy();
        resolve({ status: 0, headers: {}, body: "" });
      });
    }
  });
}

const post = (
  port: number,
  payload: unknown,
  headers?: Record<string, string>,
) =>
  raw({
    port,
    method: "POST",
    path: "/mcp",
    headers: { ...MCP_HEADERS, ...headers },
    body: JSON.stringify(payload),
  });

beforeEach(() => {
  transports.reset();
});

afterEach(async () => {
  await running?.shutdown();
  running = undefined;
});

describe("an MCP client over Streamable HTTP", () => {
  it("completes a handshake and calls a tool", async () => {
    const port = await boot();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://${HOST}:${port}/mcp`),
    );
    await client.connect(transport);

    // The full tool set is wire-envelope.test.ts's invariant over
    // InMemoryTransport; here it only has to arrive at all.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("vestlang_lint");

    const result = (await client.callTool({
      name: "vestlang_lint",
      arguments: { dsl: "1/2 VEST OVER 12 months EVERY 1 month" },
    })) as { structuredContent?: Record<string, unknown> };

    // A half-allocating program is warning-only: no error-severity diagnostic,
    // but not clean either.
    expect(result.structuredContent).toMatchObject({
      ok: true,
      errorFree: true,
      clean: false,
    });

    await client.close();
  });
});

describe("the stateless transport", () => {
  it("returns no session id and accepts a second initialize", async () => {
    const port = await boot();

    const first = await post(port, initialize(1));
    expect(first.status).toBe(200);
    expect(first.headers["mcp-session-id"]).toBeUndefined();

    // A stateful transport would reject this one as already initialized.
    const second = await post(port, initialize(2));
    expect(second.status).toBe(200);
    expect(JSON.parse(second.body)).toMatchObject({ id: 2 });
  });

  it("refuses GET and DELETE on /mcp", async () => {
    const port = await boot();

    // Left to the transport, a GET in stateless mode opens an SSE stream that
    // never emits and hangs the client — so these are answered by our own routes.
    for (const method of ["GET", "DELETE"]) {
      const res = await raw({
        port,
        method,
        path: "/mcp",
        headers: { accept: "application/json, text/event-stream" },
      });
      expect(res.status, method).toBe(405);
      expect(res.headers.allow, method).toBe("POST");
    }
  });
});

describe("host header validation", () => {
  const allowedHosts = ["vestlang.internal"];

  it("guards /mcp", async () => {
    const port = await boot({ allowedHosts });

    const rejected = await post(port, initialize(1), { host: "attacker.test" });
    expect(rejected.status).toBe(403);

    const accepted = await post(port, initialize(2), {
      host: `vestlang.internal:${port}`,
    });
    expect(accepted.status).toBe(200);
  });

  it("does not guard /health, which an orchestrator probes by IP", async () => {
    const port = await boot({ allowedHosts });

    const res = await raw({
      port,
      method: "GET",
      path: "/health",
      headers: { host: `10.1.2.3:${port}` },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      status: "ok",
      name: "vestlang-mcp-server",
      version: expect.any(String),
    });
  });
});

describe("per-request isolation", () => {
  it("builds a server and transport per request, never shared", async () => {
    const port = await boot();

    const [a, b] = await Promise.all([
      post(port, lintCall(11, "VEST OVER 48 months EVERY 1 month")),
      post(port, lintCall(22, "1/2 VEST OVER 12 months EVERY 1 month")),
    ]);

    expect(transports.constructed).toHaveLength(2);
    expect(transports.constructed[0]).not.toBe(transports.constructed[1]);

    const parsed = [a, b].map(
      (res) =>
        JSON.parse(res.body) as {
          id: number;
          result: { structuredContent: { clean: boolean } };
        },
    );
    expect(parsed[0].id).toBe(11);
    expect(parsed[0].result.structuredContent.clean).toBe(true);
    expect(parsed[1].id).toBe(22);
    expect(parsed[1].result.structuredContent.clean).toBe(false);
  });

  it("closes every transport it builds, including on an aborted request", async () => {
    const port = await boot();

    await post(port, initialize(1));
    await post(port, lintCall(2, "VEST OVER 48 months EVERY 1 month"));
    await raw({
      port,
      method: "POST",
      path: "/mcp",
      headers: MCP_HEADERS,
      body: JSON.stringify(lintCall(3, "VEST OVER 48 months EVERY 1 month")),
      abort: true,
    });

    await vi.waitFor(() => {
      expect(transports.constructed.length).toBeGreaterThanOrEqual(3);
      expect(transports.closed.size).toBe(transports.constructed.length);
    });
  });
});

describe("shutdown", () => {
  it("releases the listener even with an idle keep-alive connection open", async () => {
    const port = await boot();
    const agent = new Agent({ keepAlive: true });
    // Node 19 folded closing idle connections into close(); the package's
    // declared floor is 18.2, where a bare close() waits on them instead. So the
    // call is asserted as well as its effect — on this runtime the effect alone
    // would hold either way.
    const closeIdle = vi.spyOn(running!.server, "closeIdleConnections");

    // The socket stays pooled and idle after this — the state an MCP client
    // between calls leaves behind.
    const probe = await raw({ port, method: "GET", path: "/health", agent });
    expect(probe.status).toBe(200);

    await running!.shutdown();
    running = undefined;
    agent.destroy();
    expect(closeIdle).toHaveBeenCalled();

    await expect(raw({ port, method: "GET", path: "/health" })).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });
});
