# @vestlang/mcp-server

## 0.1.0

### Minor Changes

- e0c010d: The MCP server can now serve over Streamable HTTP as well as stdio, for running vestlang
  as a shared service inside your own network: `npx -y @vestlang/mcp-server --http` listens
  on `POST /mcp` with a `GET /health` probe. Configure it with `VESTLANG_MCP_PORT` (default
  `3000`), `VESTLANG_MCP_HOST` (default `127.0.0.1`) and `VESTLANG_MCP_ALLOWED_HOSTS`.

  It is stateless — a fresh server and transport per request — and ships unauthenticated, so
  the network perimeter is yours to own; the README covers the security posture and the
  deployment shapes. With no arguments the server still speaks stdio exactly as before,
  though an unrecognized argument is now a usage error instead of being ignored.

- f68d756: Publish the MCP server to npm. An MCP host can now launch it with
  `npx -y @vestlang/mcp-server` — no clone, no build. The private workspace
  packages are bundled into the published artifact, so the only runtime
  dependencies are `@modelcontextprotocol/sdk` and `zod`.

### Patch Changes

- bee58ec: Schedules whose shares are exact whole numbers of shares now vest those whole numbers.
  A vesting percentage is written to storage as a ten-place decimal, and it used to be
  cut short there — so a third of a 30,000-share grant stored as `0.3333333333` and paid
  9,999 on the cliff, and `19/48 VEST … THEN 29/48 VEST …` of 48,000 paid 18,999 where
  19,000 was exact. Percentages now round up to the ten-place grid instead, which the
  share math's rounding-down absorbs: `VEST OVER 3 years EVERY 1 year CLIFF 1 year` over
  30,000 shares vests 10,000 a year, and the 19/48 split pays its 19,000.

  Multi-statement schedules are written as running totals rounded to the grid, so the
  set still adds up to exactly what was authored — a schedule that leaves shares
  unvested keeps leaving them, and one that over-allocates is still refused rather than
  reshaped. A single tranche can now land one share high (and a later one one share low)
  at grants above roughly a billion shares; the schedule total is unaffected.

  The `precision-insufficient` warning is correspondingly quieter. It no longer fires
  where the stored decimal now lands the right count, and no longer recommends a
  replacement decimal — a value that lands one grant is wrong at the next, and a stored
  template carries no grant. It still fires where ten places genuinely cannot express the
  schedule at the grant size, and still warns conservatively for a cliff lump whose
  realized size depends on what vests before it.

- 5eb9882: `vestlang_lint`, `vestlang_evaluate`, and `vestlang_persist` now reject a gate that
  pins both sides of a BEFORE/AFTER comparison to the same non-date anchor and can never
  be satisfied whenever the event fires — for example `FROM EVENT ipo STRICTLY AFTER
EVENT ipo`, or `FROM EVENT s AFTER EVENT b AND STRICTLY BEFORE EVENT b`. Previously such
  a schedule linted clean and stored as a template even though it resolves to impossible
  the instant the referenced event fires. Lint raises a new `unsatisfiable-event-gate`
  error, evaluate reports the schedule as impossible / not representable, and persist
  refuses it. The check is firing-invariant and deliberately conservative: when an offset
  delta can't be ordered without committing to month lengths (a mixed-sign month+day
  offset), it abstains, so genuinely satisfiable gates are never flagged. Fixed-date gates
  continue to route through the existing `unsatisfiable-date-window` rule, unchanged.
