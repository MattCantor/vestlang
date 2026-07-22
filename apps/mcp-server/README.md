# @vestlang/mcp-server

An [MCP](https://modelcontextprotocol.io) server for
[vestlang](https://github.com/MattCantor/vestlang), the DSL for equity vesting schedules —
including the contingency (`LATER OF` / `EARLIER OF`, event gates) that a cap-table
interchange can't hold on its own.

It gives an MCP host the whole vestlang pipeline as tools, and ships the grammar, the
spec, and worked examples as resources so a model can look up the syntax instead of
guessing at it.

## Running it over stdio

```bash
npx -y @vestlang/mcp-server
```

With no arguments the server speaks MCP over stdio, so it is launched by the host rather
than run as a long-lived service. Configure it the way your host expects — for a host
using the common `mcpServers` shape:

```json
{
  "mcpServers": {
    "vestlang": {
      "command": "npx",
      "args": ["-y", "@vestlang/mcp-server"]
    }
  }
}
```

No API keys and no state on disk: every tool is pure computation over the text you pass
it. Launched this way there is no network involved at all — the host talks to the process
over its own pipes.

## Running it over HTTP

For a shared internal deployment — several agents calling one endpoint on infrastructure
you own — the same server speaks MCP's Streamable HTTP transport instead:

```bash
npx -y @vestlang/mcp-server --http
```

It serves `POST /mcp`, and `GET /health` for a liveness probe (`{"status":"ok"}` plus the
server name and version). Any other argument prints usage and exits non-zero, so a typo'd
flag can't quietly start the wrong transport. `SIGTERM`/`SIGINT` shut the listener down
gracefully, including idle keep-alive connections.

**It ships unauthenticated.** Anything that can reach the port can call every tool. The
tools hold no secrets of ours, but the inputs are your client data, so the perimeter is
yours: keep it on a private network, and put your own authentication and TLS in front of
it if it is reachable more widely.

The server is stateless — no session id, and a fresh MCP server and transport per
request, with nothing kept between them. There is no server-push notification stream
either, so `GET /mcp` answers `405` by design rather than because something is broken;
clients that probe for a stream carry on without one.

### Configuration

| Variable                     | Default     | Meaning                                                   |
| ---------------------------- | ----------- | --------------------------------------------------------- |
| `VESTLANG_MCP_PORT`          | `3000`      | Port to listen on.                                        |
| `VESTLANG_MCP_HOST`          | `127.0.0.1` | Address to bind.                                          |
| `VESTLANG_MCP_ALLOWED_HOSTS` | unset       | Comma-separated `Host` header allowlist, for binding wide. |

The names are prefixed because a container commonly already has `PORT` and `HOST` set for
something else.

Bound to a localhost address, the server rejects requests whose `Host` header is anything
but localhost — DNS-rebinding protection, on by default. Binding wider (`0.0.0.0` in a
container, say) turns that off unless you name the hostnames yourself:
`VESTLANG_MCP_ALLOWED_HOSTS=vestlang.internal,[::1]` — IPv6 addresses in brackets, as the
MCP SDK expects them. `/health` is deliberately outside that check, so an orchestrator can
probe it by pod IP.

Request bodies are capped at 100 kB, which is the default of the JSON body parser the MCP
SDK's express helper wires up and is not overridable from here. That is on the order of a
thousand vesting tranches in one call, so it does not bind in practice.

### Deploying it

`npx` is fine for a trial. For anything you depend on, install the package and commit the
lockfile, then run the bin under whatever supervises your services (systemd, an init
process in your own image, a container orchestrator):

```bash
npm install @vestlang/mcp-server
VESTLANG_MCP_HOST=0.0.0.0 VESTLANG_MCP_ALLOWED_HOSTS=vestlang.internal \
  ./node_modules/.bin/vestlang-mcp --http
```

`npx -y @vestlang/mcp-server --http` is not a production mechanism: it resolves a version
at run time, needs the registry reachable at every boot, has nothing supervising it, and
leaves no auditable lockfile.

## What it exposes

**Tools.** `vestlang_parse`, `vestlang_compile`, and `vestlang_stringify` for the
syntax round trip; `vestlang_lint` for diagnostics; `vestlang_evaluate`,
`vestlang_evaluate_as_of`, and `vestlang_vested_between` for projecting a program
against a grant date, a share count, and named events; `vestlang_infer_schedule` and
`vestlang_verify_observations` for the inverse problem — observed tranches back to a
best-fit schedule, then checked against what you know; `vestlang_persist` and
`vestlang_rehydrate` for the canonical interchange form; and `vestlang_add_period`,
`vestlang_date_diff`, `vestlang_resolve_offset`, `vestlang_resolve_vesting_day` for the
underlying date math (month-end clamping, day-of-month policy) on its own.

**Resources.** `vestlang://docs/grammar` is the authoring guide and the one to fetch
before composing a statement; `vestlang://docs/authoring` covers the
propose-verify-refine loop for a narrative with a few known figures. Alongside them:
`vestlang://docs/spec`, `vestlang://docs/evaluation`, `vestlang://docs/ast`,
`vestlang://examples/valid-statements`, and `vestlang://examples/common-queries`.

## License

MIT
