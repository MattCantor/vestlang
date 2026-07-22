// Process input — argv and env — turned into a decision, with nothing started.
// Kept out of index.ts so it can be exercised without booting a server.
import type { HttpConfig } from "./http.js";

/** What the command line asked for. */
export type Invocation =
  | { mode: "stdio" }
  | { mode: "http" }
  | { mode: "usage-error"; message: string };

const USAGE = `Usage:
  vestlang-mcp            speak MCP over stdio (the default; the host launches it)
  vestlang-mcp --http     serve MCP over Streamable HTTP at POST /mcp

Environment (--http only):
  VESTLANG_MCP_PORT           port to listen on (default 3000)
  VESTLANG_MCP_HOST           address to bind (default 127.0.0.1)
  VESTLANG_MCP_ALLOWED_HOSTS  comma-separated Host header allowlist, needed when
                              binding beyond localhost (unset by default)`;

// Arguments used to be ignored wholesale, so a typo'd `--htpp` would have started
// a stdio server nothing was talking to. Anything unrecognized is an error now.
export function parseArgs(argv: readonly string[]): Invocation {
  if (argv.length === 0) return { mode: "stdio" };
  if (argv.length === 1 && argv[0] === "--http") return { mode: "http" };
  return {
    mode: "usage-error",
    message: `vestlang-mcp: unrecognized argument${argv.length > 1 ? "s" : ""}: ${argv.join(" ")}\n\n${USAGE}`,
  };
}

export type ConfigResult =
  | { ok: true; config: HttpConfig }
  | { ok: false; message: string };

const DEFAULT_PORT = 3000;
// The SDK's own default, and the one that earns its automatic DNS-rebinding
// protection.
const DEFAULT_HOST = "127.0.0.1";

const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * Reads the `--http` knobs out of the environment. Prefixed names throughout: a
 * firm-internal container usually has bare PORT/HOST set for something else.
 */
export function readHttpConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const rawPort = env.VESTLANG_MCP_PORT?.trim();
  let port = DEFAULT_PORT;
  if (rawPort) {
    // Stricter than parseInt, which takes "3000x", and than Number, which takes
    // "3e3". An unusable value has to stop startup rather than be coerced:
    // listen() on a NaN binds an arbitrary port nobody can reach.
    const parsed = /^\d+$/.test(rawPort) ? Number(rawPort) : undefined;
    if (parsed === undefined || parsed < MIN_PORT || parsed > MAX_PORT) {
      return {
        ok: false,
        message: `vestlang-mcp: VESTLANG_MCP_PORT must be a port number between ${MIN_PORT} and ${MAX_PORT}, got "${rawPort}"`,
      };
    }
    port = parsed;
  }

  // Naively split, an empty VESTLANG_MCP_ALLOWED_HOSTS yields [""] — truthy, so
  // the SDK would install host validation that rejects everything, silently. An
  // all-empty list means unset.
  const allowedHosts = (env.VESTLANG_MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);

  return {
    ok: true,
    config: {
      port,
      host: env.VESTLANG_MCP_HOST?.trim() || DEFAULT_HOST,
      allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
    },
  };
}
