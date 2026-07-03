import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { inferSchedule, InferInputError } from "@vestlang/inferrer";
import { errorDiagnostics, lintText } from "@vestlang/linter";
import { MAX_INSTALLMENTS } from "@vestlang/primitives";
import { stringify } from "@vestlang/render";
import {
  parseRaw,
  parseToProgram,
  runEvaluate,
  runAsOf,
  runVestedBetween,
  runPersist,
  runRehydrate,
  runResolveOffset,
  type GrantInput,
} from "@vestlang/pipeline";
import type { OCTDate, Program, Statement } from "@vestlang/types";
import {
  DEFAULT_VESTING_DAY_OF_MONTH,
  VESTING_DAY_OF_MONTH_VALUES,
} from "@vestlang/types";
import { registerResources } from "./resources.js";
import { addPeriod, dateDiff, resolveVestingDay } from "./date-math.js";
import { PERSISTED_ARTIFACT } from "./artifact-schema.js";
import { ISO_DATE } from "./iso-date.js";

const INSTRUCTIONS = `Vestlang is a DSL for equity vesting schedules. This server
exposes the full vestlang pipeline (parse, compile, evaluate, lint, stringify)
as tools, and publishes the grammar/spec/examples as resources.

Typical workflows:
- Natural language → vestlang: vestlang://docs/grammar is the authoritative
  syntax and constraints — fetch it first. vestlang://examples/valid-statements
  is a small set of intent→syntax patterns; use it as a pattern reference, not
  the source of truth. Compose a statement, then always validate with
  vestlang_lint (and vestlang_parse for syntax) before showing it — on any
  diagnostic, fix and re-validate.
- Vestlang → plain English: call vestlang_compile to inspect the normalized
  AST, then explain it to the user.
- Scenario modeling: call vestlang_evaluate or vestlang_evaluate_as_of with
  a grant_date, grant_quantity, and any named events that the DSL references.
  Both treat the program as one grant — its statements collapse into a single
  schedule rather than being judged branch by branch. vestlang_evaluate returns
  the whole schedule with TWO verdicts: \`interchange\` (the "storable" verdict —
  what a record keeper could hold, computed without reading firings) and
  \`resolution\` (the "resolves-to" verdict — what it works out to given the events
  you passed). They can differ — a gated start is a storable template that may
  resolve to impossible after an early firing. It also carries \`absenceAssumptions\`:
  events the resolves-to reading is assuming stayed absent (each
  { eventId, through, direction, inclusive, consequence, message } —
  direction-aware: the dangerous firing falls on the before/after side of
  \`through\`; \`consequence\` says how much it changes — grid-shift = a tranche
  moves, flips-to-impossible = the grant dies), whose later or backdated firing
  could change the
  answer — and a \`breakdown\`: each clause's own tranches and blockers (split into
  \`pendingBlockers\` and \`deadBlockers\`), for when you need to see which clause
  produced what.
- Tranche array → vestlang: call vestlang_infer_schedule on an array of
  {date, amount} pairs to get the best-fit DSL. Candidate templates are derived
  analytically from the stream's date lattice and cumulative sums, each verified by
  evaluating it back through the real engine; the first that reproduces the stream
  in a fixed preference order wins, and anything unrecognized falls back to a
  literal per-date list. Note that the returned diagnostics.vestingDayOfMonth is not
  encoded in the DSL — pass it back as the vesting_day_of_month input when
  evaluating the returned DSL.
- Persistence lifecycle: vestlang_persist compiles a DSL program ONCE into a
  storable artifact (canonical template + runtime + an out-of-band sidecar that
  maps each synthetic event to its definition). A program is storable only when it
  is lint-clean of error-severity diagnostics, valid, and resolves to a single
  \`template\`; anything else returns a clear error — a program the linter flags with
  an error (e.g. an unsatisfiable date window) is refused naming the diagnostic, an
  invalid program that over-allocates the grant is refused naming the
  over-allocation, and one whose shape isn't a single template is refused naming the
  status. A warning does not block storage. As the real-world events the schedule
  gates on actually fire, call vestlang_rehydrate
  with the stored artifact and the world's named-event firings — it returns the
  DELTA of synthetic events to now fire in the system of record (each with the
  date and the definition it resolved against), what's still pending, and the
  dated projection the record keeper will show once those firings are applied.

Dates are YYYY-MM-DD. Statements that reference named events (e.g.
EVENT "ipo") require those events to appear in the events map — otherwise the
schedule comes back pending: it carries blockers naming the unfired event, an empty or
partial projection, and (when the event was compared against a date) an entry in
absenceAssumptions. A comparison against an unfired event is pending, never silently
satisfied or impossible — the event could still be recorded later, even backdated.

Every tool result is tagged with a top-level \`ok\` boolean — one envelope across
all tools, success or refusal. On success: { ok: true, ...payload }. On a
structured refusal the tool still ran fine and its answer is the refusal:
{ ok: false, error: { ruleId, message, loc?, unresolved? } }. The \`ruleId\` is the
machine-readable failure code, present on every refusing tool ("syntax-error" for
malformed DSL, carrying \`loc\` — the source span; "evaluation-error"; tool-specific
codes such as "persist-not-storable", "rehydrate-missing-grant-date",
"offset-unresolved"). \`message\` is the human-readable explanation. Branch on
\`ok\` — a false \`ok\` is data to read, not a thrown error.

That envelope is separate from MCP's \`isError\` flag. \`isError: true\` marks a
genuine unstructured exception (a bad-input throw from vestlang_stringify or
vestlang_infer_schedule, a date-math overflow past the representable range, or an
input-schema rejection) — there is no \`ruleId\` to expose and no \`ok\` on the
result. A robust consumer checks \`isError\` first (protocol/exception failure),
then \`ok\` (structured refusal vs. success).

Note \`ok\` is the envelope flag, distinct from any domain field inside a success:
vestlang_evaluate's \`valid\` (false ⇔ the schedule over-allocates the grant) and
vestlang_lint's \`errorFree\` (false ⇔ there are error-severity diagnostics) both
live inside an { ok: true, ... } result.`;

/* ------------------------
 * Shared Zod schemas
 * ------------------------ */

// Consumes the canonical value array from @vestlang/types rather than re-spelling
// the four policy codes here — a dropped or renamed entry fails typecheck at the source.
const VESTING_DAY_OF_MONTH = z.enum(VESTING_DAY_OF_MONTH_VALUES);

const DSL_INPUT = z
  .string()
  .min(1, "dsl must not be empty")
  .describe("Vestlang DSL source (one or more statements)");

const EVAL_CONTEXT_FIELDS = {
  grant_date: ISO_DATE.describe("Grant date (YYYY-MM-DD)"),
  grant_quantity: z
    .number()
    .int("grant_quantity must be a whole number")
    .min(0, "grant_quantity must be non-negative")
    .max(
      Number.MAX_SAFE_INTEGER,
      "grant_quantity must be within the safe integer range",
    )
    .describe("Total shares granted"),
  events: z
    .record(z.string().min(1), ISO_DATE)
    .optional()
    .describe(
      `Named events referenced by the DSL, e.g. {"ipo": "2027-06-01"}. grantDate is set automatically.`,
    ),
  vesting_day_of_month: VESTING_DAY_OF_MONTH.optional().describe(
    `OCT VestingDayOfMonth. Defaults to ${DEFAULT_VESTING_DAY_OF_MONTH}.`,
  ),
};

/* ------------------------
 * Helpers
 * ------------------------ */

// The four grant scalars the evaluate tools share, pulled out of a tool's params
// (already validated by the zod schema above) and handed to the pipeline, which
// owns the rest: context construction, the grantDate injection, evaluation.
function toGrant(p: {
  grant_date: string;
  grant_quantity: number;
  events?: Record<string, string>;
  vesting_day_of_month?: z.infer<typeof VESTING_DAY_OF_MONTH>;
}): GrantInput {
  return {
    grant_date: p.grant_date,
    grant_quantity: p.grant_quantity,
    events: p.events,
    vesting_day_of_month: p.vesting_day_of_month,
  };
}

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function jsonResult<T>(output: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
    structuredContent: output as Record<string, unknown>,
  };
}

// Tags a success payload with the envelope's `ok: true`. Used where the wire
// intentionally spreads/renames fields (the evaluate family, the pure tools,
// lint) rather than passing a `Result` through whole. A `Result`'s own success
// arm already carries `ok: true`, so those go straight to `jsonResult(result)`.
function okResult<T extends Record<string, unknown>>(payload: T) {
  return jsonResult({ ok: true as const, ...payload });
}

/* ------------------------
 * Server
 * ------------------------ */

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "vestlang-mcp-server", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  registerResources(server);

  /* parse: DSL → raw AST (pre-normalization) */
  server.registerTool(
    "vestlang_parse",
    {
      title: "Parse vestlang",
      description:
        "Parse vestlang DSL text into a raw AST (RawProgram). On success returns { ok: true, ast }. A syntax error returns { ok: false, error } with the diagnostic ruleId and source location.",
      inputSchema: z.strictObject({ dsl: DSL_INPUT }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ dsl }) => {
      // The Result already carries the `ok` discriminant on both arms, so it
      // rides the wire whole — no per-handler reshaping.
      return jsonResult(parseRaw(dsl));
    },
  );

  /* compile: DSL → normalized AST */
  server.registerTool(
    "vestlang_compile",
    {
      title: "Compile vestlang to normalized AST",
      description:
        "Parse vestlang DSL text and produce the normalized canonical AST (Program). Use this when reasoning about the structure of a schedule; it is the same shape the evaluator consumes. This is the PARSE tool (DSL → AST), not an allocatability oracle: producing the AST does not certify the schedule fits the grant — for the over-allocation answer call vestlang_evaluate, vestlang_evaluate_as_of, or vestlang_vested_between and read their `valid` / `findings` channel (and vestlang_persist refuses an over-allocating program).",
      inputSchema: z.strictObject({ dsl: DSL_INPUT }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ dsl }) => {
      // Pass the Result through whole — its `ok` discriminant is the envelope.
      return jsonResult(parseToProgram(dsl));
    },
  );

  /* stringify: AST → DSL source text */
  server.registerTool(
    "vestlang_stringify",
    {
      title: "Stringify AST to vestlang",
      description:
        "Convert a vestlang AST (either a Statement or a Program array) back into DSL source text. Useful for round-tripping or presenting a machine-generated schedule as canonical vestlang.",
      inputSchema: z.strictObject({
        ast: z
          .unknown()
          .describe(
            "A vestlang Statement or Program (array of Statements). Typically obtained from vestlang_compile.",
          ),
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ ast }) => {
      try {
        // MCP clients sometimes serialize a structured argument as a JSON string
        // (the input schema is `unknown`, so the SDK doesn't parse it for us).
        // Accept either a parsed Statement/Program or its stringified form.
        const node =
          typeof ast === "string"
            ? (JSON.parse(ast) as Statement | Program)
            : (ast as Statement | Program);
        const text = stringify(node);
        return okResult({ dsl: text });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(
          `Stringify failed: ${msg}. Pass a Statement or Program from vestlang_compile.`,
        );
      }
    },
  );

  /* infer_schedule: {date, amount}[] → DSL via analytic hypothesize-and-verify */
  server.registerTool(
    "vestlang_infer_schedule",
    {
      title: "Infer vestlang from tranche array",
      description:
        "Reverse of vestlang_evaluate: take an array of {date, amount} vesting tranches (at most " +
        MAX_INSTALLMENTS +
        " entries) and return the best-fit vestlang DSL source. Candidates are derived analytically from the stream's date lattice and cumulative sums — a plain uniform train, a cliff, a pre-grant fold, a per-segment-cadence THEN chain, or a single dated lump — and each is verified by evaluating it through the real engine and checking it reproduces the input exactly. The first verifying candidate in a fixed preference order (plain < cliff < pre-grant fold < THEN chain < single lump) wins; anything unrecognized becomes a literal per-date list (projection-lossless by construction). Always round-trip verified: the returned DSL, when evaluated with the reported vestingDayOfMonth, reproduces the input. The `decomposition` field is one component per emitted statement, each tagged by the family that produced it (plain | cliff | fold | then-segment | literal) with its derived parameters (start, occurrences, period, total, and cliff length where present). IMPORTANT: the returned diagnostics.vestingDayOfMonth is NOT encoded in the DSL itself — consumers who later call vestlang_evaluate on the returned DSL must pass it back as the vesting_day_of_month input, or they will get a slightly different schedule.",
      inputSchema: z.strictObject({
        tranches: z
          .array(
            z.strictObject({
              date: ISO_DATE,
              amount: z
                .number()
                .int("tranche amount must be a whole number")
                .min(0, "tranche amount must be non-negative")
                .describe("Tranche amount (not cumulative)"),
            }),
          )
          .min(1, "tranches must contain at least one entry")
          .max(
            MAX_INSTALLMENTS,
            `tranches must contain at most ${MAX_INSTALLMENTS} entries`,
          )
          .describe(
            `Array of {date, amount} vesting tranches. Same-date tranches are summed. At most ${MAX_INSTALLMENTS} entries.`,
          ),
        grant_date: ISO_DATE.optional().describe(
          "Optional grant date anchor. If omitted, defaults to the first tranche date.",
        ),
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ tranches, grant_date }) => {
      try {
        const result = inferSchedule({
          tranches: tranches.map((t) => ({
            date: t.date,
            amount: t.amount,
          })),
          grantDate: grant_date,
        });
        return okResult({ ...result });
      } catch (err: unknown) {
        // Input-contract violations carry a clean domain message; anything else
        // is an internal error from a deeper layer and must not leak its text.
        if (err instanceof InferInputError) {
          return toolError(`Inference failed: ${err.message}.`);
        }
        return toolError(
          "Inference failed: could not infer a schedule from the provided tranches.",
        );
      }
    },
  );

  /* evaluate: DSL + context → the grant's collapsed schedule + per-clause breakdown */
  server.registerTool(
    "vestlang_evaluate",
    {
      title: "Evaluate vesting schedule",
      description:
        'Evaluate a vestlang program against a grant context. The program is treated as ONE grant: its statements collapse into a single schedule of installments (RESOLVED / UNRESOLVED / IMPOSSIBLE) with blockers, and you get TWO verdicts on it. `interchange` — the storable verdict, what a record keeper could hold, computed WITHOUT reading firings: "template" (fits one canonical template), "events-only" (resolves to dated amounts but cannot be one template — e.g. two overlapping independent absolute starts — with a `reason`), "unrepresentable" (no storable form even as bare events — largely vacated for cliffs now; the remaining causes, each named in a `reason`: a cliff that can\'t be placed until an event fires (a cross-unit deferred cliff), or a THEN tail chained behind a start still waiting on an event. An event-held cliff is NOT unrepresentable — it stores as a `template`, with the time baseline in `cliff` and the event hold in `event_condition`), or "impossible" (a structural contradiction). `resolution` — the resolves-to verdict given the events you passed: "template", "events-only", "unresolved" (pending on an unfired event), or "impossible". The two can differ — a gated start is a storable `template` that may resolve to `impossible` after an early firing. Also returns `representable` (from `interchange`), `pending` (witnesses still missing — a `template` can be pending, so read pending from this flag / `pendingBlockers`, never from a verdict status), `dead` (something contradicted given the firings — read off `deadBlockers`; distinct from a terminal `impossible` status, since a live statement can sit beside a dead one). A held grid (an unfired event-anchored or `LATER OF` cliff) emits UNRESOLVED installments whose `symbolicDate` is `{ type: "UNRESOLVED_CLIFF", date, floor? }`: `date` is the honest cadence (grid) position, and `floor` (optional) discloses the earliest the tranche could land — the resolved `LATER OF` time-arm date — present only when that time arm has resolved, omitted for a bare `CLIFF EVENT e`. The cadence `date` is not lifted to the floor; both are surfaced. Plus `valid` (false when the program allocates more than the grant) with a single `findings` array (each `kind`, `severity`, exact `sum`, human `message`) computed over the whole program; installments are still returned when `valid` is false but aren\'t a valid schedule. It carries `absenceAssumptions` (events the resolves-to reading assumes stayed absent, each { eventId, through, direction, inclusive, consequence, message } — direction-aware: `direction` ("before"/"after") and `inclusive` say which side of `through` a dangerous firing of the event falls on, so a `BEFORE`/EARLIER OF watch names the on/before side and an `AFTER`/LATER OF watch the on/after side; a later or backdated firing on that side could change the result. `consequence` says how much that firing changes: "flips-to-impossible" (a gate the grant can no longer satisfy — a dead grant) or "grid-shift" (a selector re-anchoring — the schedule just moves)), and `breakdown` — one entry per clause (a THEN chain reports as one entry, since its segments can\'t be placed apart) with that clause\'s own installments and blockers, split into `pendingBlockers` and `deadBlockers` (no verdict; a clause has no storable schedule of its own), for attribution. When a vesting start precedes the grant date, the breakdown\'s folded grant-date line also carries `scheduled` — the pre-fold partition `[{ scheduledDate, amount }]` of the shares it absorbed (each pre-grant row at the date it would have vested, plus any native grant-date share), `present only when at least one tranche was pulled forward onto the grant date` and summing to the line\'s amount. This rides the breakdown ONLY — the headline installments, `vestlang_evaluate_as_of`, and `vestlang_vested_between` stay folded and bare — so a consumer can report the would-have-vested dates without vestlang picking a side. The per-clause amounts are a true partition of the one headline allocation, so they sum to the headline by construction — each clause adopts the headline\'s odd-share placement (1/3 PLUS 1/3 PLUS 1/3 of 100 reads 33/33/34 here and in the headline). When `valid` is false the headline itself over-allocates the grant; the breakdown still sums to that over-allocating total — the warning is the over-allocation `findings` entry, not the breakdown. On a rescue — an events-only program whose realized projection collapses back to a single template — the verdict reads "template" and a `recovered` block records what it was rescued from (the events-only `reason`, the inferred single-template `dsl`, its `vestingDayOfMonth`, and a `residualError`); it is absent otherwise. Does not filter by date — use vestlang_evaluate_as_of for a point-in-time view. Note: compiling or evaluating a schedule does not by itself certify it fits the grant — the over-allocation answer is the `valid` / `findings` channel on this result (for a raw canonical template, the @vestlang/core checker `validateTemplateAllocatable`).',
      inputSchema: z.strictObject({
        dsl: DSL_INPUT,
        ...EVAL_CONTEXT_FIELDS,
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = runEvaluate(params.dsl, toGrant(params));
      if (!result.ok) return jsonResult({ ok: false, error: result.error });
      // The view carries the verdicts and published fields; the breakdown rides
      // alongside (its per-clause amounts sum to the headline by construction), and
      // on a rescue so does the recovered block (events-only reason + inferred DSL).
      return okResult({
        ...result.view,
        breakdown: result.breakdown,
        ...(result.recovered ? { recovered: result.recovered } : {}),
      });
    },
  );

  /* evaluate_as_of: DSL + context + asOf date → vested / unvested / impossible / unresolved */
  server.registerTool(
    "vestlang_evaluate_as_of",
    {
      title: "Evaluate vesting as of a date",
      description:
        "Partition the grant's installments into {vested, unvested, impossible} with an unresolved count (shares not yet schedulable), as of a given date (defaults to today), plus a `summary` roll-up (total vested/unvested, percent vested, next vest, fully-vested date). The program is collapsed into one schedule first, so this is the grant-wide answer to 'how much is vested right now?'. Also carries the validity channel: `valid` (false when the program allocates more than the grant — e.g. `0.6 …` PLUS `0.6 …` of the same grant reaches 120%) and a `findings` array (each with `kind`, `severity`, exact `sum`, and a human `message`). When `valid` is false the partition and summary are still returned but annotate, not certify: `percent_vested` and the totals stay honest (so percent can exceed 1), only `fully_vested_date` is nulled (it would otherwise assert a false completion). Compiling/evaluating a schedule does not by itself certify it fits the grant — that answer is exactly this `valid` / `findings` channel. For the verdicts and storability flags, use vestlang_evaluate.",
      inputSchema: z.strictObject({
        dsl: DSL_INPUT,
        ...EVAL_CONTEXT_FIELDS,
        as_of: ISO_DATE.optional().describe(
          "As-of date (YYYY-MM-DD). Defaults to today.",
        ),
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = runAsOf(params.dsl, toGrant(params), params.as_of);
      if (!result.ok) return jsonResult({ ok: false, error: result.error });
      return okResult({
        as_of: result.asOf,
        vested: result.vested,
        unvested: result.unvested,
        impossible: result.impossible,
        unresolved: result.unresolved,
        summary: result.summary,
        valid: result.valid,
        findings: result.findings,
      });
    },
  );

  /* vested_between: DSL + context + window → installments within [from, to] */
  server.registerTool(
    "vestlang_vested_between",
    {
      title: "Vested shares in a date window",
      description:
        "Return the grant's RESOLVED installments whose vest date falls within [from, to] (inclusive), along with the sum. Use this for questions like 'how much vested in H2 2025?' or 'how many tranches released between 2025-01-01 and 2025-12-31?'. The program is collapsed into one schedule first; UNRESOLVED and IMPOSSIBLE installments are excluded — they haven't vested. Carries the validity channel too: `valid` (false when the program allocates more than the grant) and a `findings` array (each `kind`, `severity`, exact `sum`, human `message`); the window sum is the real total even when the schedule over-allocates. Compiling/evaluating a schedule does not by itself certify it fits the grant — that answer is this `valid` / `findings` channel.",
      inputSchema: z.strictObject({
        dsl: DSL_INPUT,
        ...EVAL_CONTEXT_FIELDS,
        from: ISO_DATE.describe("Window start, inclusive (YYYY-MM-DD)"),
        to: ISO_DATE.describe("Window end, inclusive (YYYY-MM-DD)"),
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = runVestedBetween(
        params.dsl,
        toGrant(params),
        params.from,
        params.to,
      );
      if (!result.ok) return jsonResult({ ok: false, error: result.error });
      return okResult({
        from: result.from,
        to: result.to,
        vested_in_window: result.vested_in_window,
        tranches_in_window: result.tranches_in_window,
        installments: result.installments,
        valid: result.valid,
        findings: result.findings,
      });
    },
  );

  /* lint: DSL → diagnostics (syntax + semantic) */
  server.registerTool(
    "vestlang_lint",
    {
      title: "Lint vestlang",
      description:
        "Run vestlang's syntax and semantic linter against DSL text. The call always answers (envelope `ok: true`); the lint verdict is `errorFree` (true when there are no error-severity diagnostics — valid/storable, matching vestlang_persist), alongside `clean` (true when there are no diagnostics at all) and the `diagnostics` list, each with ruleId, severity, message, and (when available) source location. Non-error diagnostics (warnings, info) are advisory: they appear in `diagnostics` and set `clean` false but do NOT flip `errorFree`.",
      inputSchema: z.strictObject({ dsl: DSL_INPUT }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ dsl }) => {
      const { diagnostics } = lintText(dsl);
      // `errorFree` ⇔ storable/valid: gates on error severity only, matching
      // vestlang_persist. `clean` ⇔ spotless: no diagnostics of any severity.
      // A warning leaves `errorFree: true`, `clean: false`. (The envelope's own
      // `ok: true`, supplied by okResult, means the lint call answered — lint
      // never refuses — and is distinct from this domain `errorFree` verdict.)
      return okResult({
        errorFree: errorDiagnostics(diagnostics).length === 0,
        clean: diagnostics.length === 0,
        diagnostics,
      });
    },
  );

  /* ------------------------
   * Persistence tools
   * ------------------------ */

  /* persist: DSL + grant context → a storable PersistedArtifact */
  server.registerTool(
    "vestlang_persist",
    {
      title: "Persist a vesting schedule to a storable artifact",
      description:
        "Compile a vestlang program ONCE into a persisted artifact: the canonical template + firing-free runtime, plus an out-of-band `sidecar` mapping each synthetic event (minted when a combinator/gated/offset start is lowered into a template) to its definition. Storing requires the program be lint-clean of error-severity diagnostics, VALID, and storable as a single `template` in the firing-invariant `interchange` verdict. A program the linter flags with an error (e.g. an unsatisfiable date window) is refused with a message naming the diagnostic. An invalid program — one that over-allocates the grant (more than 100%) — is refused naming the over-allocation, since persisting it would mint an artifact that over-vests on rehydrate. A program whose storable `interchange` shape isn't a single `template` (events-only, unrepresentable, impossible) is likewise refused, naming the status. (A warning is advisory and does NOT block storage.) Any warning-severity findings that DID survive — an under-allocation (statement shares summing below 100%, leaving part of the grant unvested) or a residual cliff-precision note — are returned in `warnings` (always present, [] when none) so the caller sees them rather than having them dropped. Also returns the closed-world `resolution` blockers, split into `pending` — advisory pending witnesses still floating at store time (e.g. a gate whose event hasn't fired), which vestlang_rehydrate later resolves — and `dead` — blockers contradicted given the firings recorded so far, which CAN be non-empty for a schedule that is storable firing-blind yet already dead given a recorded firing (a revisable disclosure; both always present). The artifact bakes no firings, so it's firing-invariant by construction — witnesses are re-derived on each rehydrate. Mirrors vestlang_evaluate's input conventions.",
      inputSchema: z.strictObject({
        dsl: DSL_INPUT,
        ...EVAL_CONTEXT_FIELDS,
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = runPersist({
        dsl: params.dsl,
        grant_date: params.grant_date,
        grant_quantity: params.grant_quantity,
        events: params.events,
        vesting_day_of_month: params.vesting_day_of_month,
      });
      // A structured refusal (`persist-not-storable`) rides the envelope as
      // { ok: false, error } so its ruleId reaches the wire — it is data, not an
      // MCP exception. (A genuine internal throw still surfaces as isError via
      // the SDK.)
      if (!result.ok) return jsonResult({ ok: false, error: result.error });
      return okResult({
        artifact: result.artifact,
        pending: result.pending,
        dead: result.dead,
        warnings: result.warnings,
      });
    },
  );

  /* rehydrate: stored artifact + the world's firings → start_to_apply + pending + projection */
  server.registerTool(
    "vestlang_rehydrate",
    {
      title: "Rehydrate a persisted artifact against fired events",
      description:
        "Re-resolve a stored PersistedArtifact (from vestlang_persist) against the world's named-event firings, and report what to do about it. Returns FIVE things: `start_to_apply` — the primary action: the grant's contingent vesting start re-derived on this reload (`{ date }`), or null when its event hasn't fired yet or the grant has no contingent start. It's the instruction to set the grant's vesting start date in the system of record; the stored artifact stays contingent and bakes no date, so this re-emits on every reload where the start resolves — apply it idempotently; `firings_to_apply` — each SYNTHETIC event_condition (an event-held cliff whose event side is richer than a bare id — the later of two events, a gated date) that this reload newly resolved, as `{ event_id, date, definition }` for the operator to apply in the system of record. A BARE real-event condition surfaces nothing here (the SoR already knows that firing from the world you supplied); [] when no synthetic hold resolved; `pending` — the start's recipe still doesn't resolve because its event simply hasn't fired yet (keep waiting), with dead/impossible arms reported SEPARATELY under `dead`, not here; `dead` — the recipe can never resolve given the firings we now know (e.g. the event fired OUTSIDE its window), so stop waiting on it (always present, [] when none); and `projection` — the dated installments from compiling the frozen template against the re-derived start with the supplied grant_quantity (what the record keeper will show once the start is applied; empty while the start is still unresolved). The grant date and day-of-month rule are the conventions frozen in the artifact, so they're read from it; you supply only the newly-fired events and grant_quantity.",
      inputSchema: z.strictObject({
        artifact: PERSISTED_ARTIFACT,
        grant_quantity: z
          .number()
          .int("grant_quantity must be a whole number")
          .min(0, "grant_quantity must be non-negative")
          .max(
            Number.MAX_SAFE_INTEGER,
            "grant_quantity must be within the safe integer range",
          )
          .describe("Total shares granted, used to size the projection"),
        events: z
          .record(z.string().min(1), ISO_DATE)
          .optional()
          .describe(
            `The world's named-event firings, e.g. {"ipo": "2027-06-01"}.`,
          ),
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = runRehydrate({
        artifact: params.artifact,
        grant_quantity: params.grant_quantity,
        events: params.events,
      });
      // The Result rides the wire whole on both arms: a structured refusal
      // (`rehydrate-*`) keeps its ruleId under { ok: false, error }, and the
      // success arm already carries `ok: true` next to its payload — no strip.
      return jsonResult(result);
    },
  );

  /* ------------------------
   * Date-math tools
   * ------------------------ */

  const PERIOD_UNIT = z.enum(["days", "weeks", "months", "years"]);

  server.registerTool(
    "vestlang_add_period",
    {
      title: "Add a period to a date",
      description:
        "Return date + (length × unit), applying the VestingDayOfMonth rule for month/year arithmetic (handles month-end, leap years, day-29/30/31 clamping). Use negative length to subtract. Units: days, weeks, months, years.",
      inputSchema: z.strictObject({
        date: ISO_DATE.describe("Starting date (YYYY-MM-DD)"),
        length: z.number().int("length must be a whole number"),
        unit: PERIOD_UNIT,
        vesting_day_of_month: VESTING_DAY_OF_MONTH.optional().describe(
          `Only applies to months/years. Defaults to ${DEFAULT_VESTING_DAY_OF_MONTH}.`,
        ),
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ date, length, unit, vesting_day_of_month: rule }) => {
      const result = addPeriod(
        date,
        length,
        unit,
        rule ?? DEFAULT_VESTING_DAY_OF_MONTH,
      );
      return okResult({ date: result });
    },
  );

  server.registerTool(
    "vestlang_date_diff",
    {
      title: "Difference between two dates",
      description:
        "Count the calendar days or whole calendar months between two dates. For months, also returns remainder_days (days from the anchor month-boundary to 'to'). Direction is signed: if 'to' is before 'from', the diff is negative. Months are anchored on 'from' — the count is how many whole months 'to' is past 'from's day-of-month — so 'from' is privileged and swapping the two does not simply negate the result near month-ends. E.g. Jan 31 -> Feb 29 is 1 month (Feb 29 is the clamped one-month landing), but Feb 29 -> Jan 31 is 0 (one month before Feb 29 is Jan 29, which Jan 31 has not yet reached).",
      inputSchema: z.strictObject({
        from: ISO_DATE,
        to: ISO_DATE,
        unit: z.enum(["days", "months"]),
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ from, to, unit }) => {
      const result = dateDiff(from, to, unit);
      return okResult({ ...result });
    },
  );

  server.registerTool(
    "vestlang_resolve_offset",
    {
      title: "Resolve an offset expression to a date",
      description:
        "Resolve a vestlang offset expression (e.g. 'EVENT ipo + 6 months', '+3 months', 'DATE 2025-01-01 - 2 days', 'EARLIER OF (EVENT a, EVENT b)') to a concrete date. Requires grant_date (used for expressions that reference the grant anchor). Named events used in the expression must be in the events map. When the date is committed against an unfired event (e.g. 'EARLIER OF (DATE d, EVENT e)' with e absent), the reply also carries an absenceAssumptions array (each { eventId, through, direction, inclusive, consequence, message }) disclosing that the answer assumes that event stayed absent — for an EARLIER OF that's the on/before side of the date, so a later or backdated firing there could move the start earlier (consequence 'grid-shift': the start re-anchors, the schedule isn't voided).",
      inputSchema: z.strictObject({
        expr: z
          .string()
          .min(1)
          .describe(
            "Offset expression as it would appear after 'VEST FROM' in the DSL.",
          ),
        grant_date: ISO_DATE,
        events: z.record(z.string().min(1), ISO_DATE).optional(),
        vesting_day_of_month: VESTING_DAY_OF_MONTH.optional(),
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ expr, grant_date, events, vesting_day_of_month: rule }) => {
      const events_oct: Record<string, OCTDate> = {};
      for (const [k, v] of Object.entries(events ?? {})) {
        events_oct[k] = v;
      }
      const result = runResolveOffset({
        expr,
        grant_date: grant_date,
        events: events_oct,
        vesting_day_of_month: rule,
      });
      return jsonResult(result);
    },
  );

  server.registerTool(
    "vestlang_resolve_vesting_day",
    {
      title: "Normalize a date under a VestingDayOfMonth rule",
      description:
        "Apply a VestingDayOfMonth rule to the given date's year+month and return the rule's picked day. Useful for questions like 'what does LAST_DAY_OF_MONTH mean for Feb 2026?' — answer: 2026-02-28. The result stays in the input month for three of the four policies; VESTING_START_DAY_MINUS_ONE can land on the prior month's last day (or the prior year's Dec 31 for a January 1st input), since it subtracts a calendar day after clamping.",
      inputSchema: z.strictObject({
        date: ISO_DATE,
        rule: VESTING_DAY_OF_MONTH,
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ date, rule }) => {
      const result = resolveVestingDay(date, rule);
      return okResult({ date: result });
    },
  );

  return server;
}
