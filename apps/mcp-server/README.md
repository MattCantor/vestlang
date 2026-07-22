# @vestlang/mcp-server

An [MCP](https://modelcontextprotocol.io) server for
[vestlang](https://github.com/MattCantor/vestlang), the DSL for equity vesting schedules —
including the contingency (`LATER OF` / `EARLIER OF`, event gates) that a cap-table
interchange can't hold on its own.

It gives an MCP host the whole vestlang pipeline as tools, and ships the grammar, the
spec, and worked examples as resources so a model can look up the syntax instead of
guessing at it.

## Running it

```bash
npx -y @vestlang/mcp-server
```

The server speaks MCP over stdio, so it is launched by the host rather than run as a
long-lived service. Configure it the way your host expects — for a host using the common
`mcpServers` shape:

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

No API keys, no network access, no state on disk: everything runs locally in the
server process.

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
