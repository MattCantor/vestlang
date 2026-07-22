import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createNodeServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer, SERVER_INFO } from "./server.js";

// Streamable HTTP for the self-hosted deployment: several agents inside a firm's
// network calling one endpoint, on infrastructure the firm owns. Nothing here
// runs on import — index.ts owns the process (signals, exit codes, lifecycle
// logging), so a test can boot this on an ephemeral port and shut it down again.

export interface HttpConfig {
  port: number;
  host: string;
  /**
   * Host header allowlist for DNS-rebinding protection. Leave unset to take the
   * SDK's default, which protects localhost binds and nothing else.
   */
  allowedHosts?: string[];
}

export interface RunningHttpServer {
  server: Server;
  shutdown: () => Promise<void>;
}

const HEALTH_BODY = JSON.stringify({ status: "ok", ...SERVER_INFO });

// The route handlers are typed by what they touch, not by express's own
// Request/Response. Express 5 ships no types of its own, so the SDK's helper is
// typed through whichever @types/express some transitive dependency has hoisted
// into the store — a copy this package neither declares nor can influence, and
// whose major version can change under it. Express's objects satisfy these
// structurally, so none of that reaches our code.
type RoutedRequest = IncomingMessage & { body?: unknown };
interface RoutedResponse extends ServerResponse {
  status(code: number): this;
  set(field: string, value: string): this;
  json(body: unknown): this;
}

/**
 * One transport per request, matched by one server per request: an McpServer
 * holds a single transport, so a shared one would let two concurrent clients
 * collide on JSON-RPC ids.
 *
 * Stateless — no session id, and JSON responses rather than an SSE stream —
 * because nothing here survives a request: the tools are pure, with no
 * notifications and no sampling. Sessions would track nothing and accumulate
 * memory on a server that ships unauthenticated. Turning them on is an edit to
 * this function.
 */
function createRequestTransport(): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
}

async function handleMcpPost(
  req: RoutedRequest,
  res: RoutedResponse,
): Promise<void> {
  const server = createServer();
  const transport = createRequestTransport();

  // 'close' rather than 'finish': a client that aborts mid-request never
  // finishes, and the pair would leak. It fires on a completed response too, so
  // this is the single teardown path — including the error arm below, which ends
  // the response precisely to reach it.
  res.on("close", () => {
    void Promise.allSettled([transport.close(), server.close()]);
  });

  try {
    await server.connect(transport);
    // The body is already parsed — createMcpExpressApp wires express.json().
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("vestlang-mcp: request failed", err);
    if (res.headersSent) {
      res.end();
    } else {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

function methodNotAllowed(res: RoutedResponse): void {
  res
    .status(405)
    .set("Allow", "POST")
    .json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
}

function pathOf(req: IncomingMessage): string {
  const url = req.url ?? "/";
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
}

export function startHttpServer(
  config: HttpConfig,
): Promise<RunningHttpServer> {
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
  });

  app.post("/mcp", (req, res) => {
    void handleMcpPost(req, res);
  });
  // The transport won't answer these for us. In stateless mode its GET handler
  // passes session validation and opens an SSE stream that never emits, which
  // hangs the client; its only built-in 405 is for PUT/PATCH. This server pushes
  // nothing and holds no session, so both verbs are simply not allowed.
  app.get("/mcp", (_req, res) => {
    methodNotAllowed(res);
  });
  app.delete("/mcp", (_req, res) => {
    methodNotAllowed(res);
  });

  // createMcpExpressApp installs host validation ahead of every route, so a
  // /health route on the app would 403 for exactly the caller it exists for — an
  // orchestrator probing a container by pod IP. Answering it out here, in front
  // of express, is the whole reason for the wrapper. Safe to expose: it reports
  // liveness and identity only, and anyone who can reach an unauthenticated
  // server can already call every tool. /mcp stays behind the validation.
  const server = createNodeServer((req, res) => {
    // HEAD as well as GET: a load balancer probing with HEAD is ordinary, and it
    // would otherwise fall through to the host validation this exists to skip.
    // Node drops the body on a HEAD response by itself.
    const probe =
      (req.method === "GET" || req.method === "HEAD") &&
      pathOf(req) === "/health";
    if (probe) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(HEALTH_BODY);
      return;
    }
    app(req, res);
  });

  return new Promise((resolve, reject) => {
    // Without this, a bind failure — port already taken, host that isn't ours —
    // emits an unhandled 'error', which EventEmitter rethrows as an uncaught
    // exception: a raw Node stack, and this promise never settles.
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.removeListener("error", reject);
      server.on("error", (err) => {
        console.error("vestlang-mcp: server error", err);
      });
      resolve({ server, shutdown: () => shutdown(server) });
    });
  });
}

function shutdown(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // A second signal during the drain window would otherwise close an already
    // closing server, and ERR_SERVER_NOT_RUNNING would read as a failed shutdown.
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
    // close() waits on open connections, not just in-flight requests, and MCP
    // clients hold keep-alive sockets open while idle — so one idle agent would
    // stall shutdown until something SIGKILLed us. Node 19 folded this into
    // close(); 18.2 is the declared floor, hence the explicit call.
    server.closeIdleConnections();
  });
}
