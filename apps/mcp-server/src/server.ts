import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parse } from "@vestlang/dsl";
import { inferSchedule, InferInputError } from "@vestlang/inferrer";
import { lintText } from "@vestlang/linter";
import { stringify } from "@vestlang/render";
import { isValidCalendarDate } from "@vestlang/utils";
import {
  parseRaw,
  parseToProgram,
  runEvaluate,
  runAsOf,
  runVestedBetween,
  type GrantInput,
} from "@vestlang/pipeline";
import type { OCTDate, Program, Statement } from "@vestlang/types";
import { VESTING_DAY_OF_MONTH_VALUES } from "@vestlang/types";
import { registerResources } from "./resources.js";
import {
  addPeriod,
  dateDiff,
  resolveOffset,
  resolveVestingDay,
} from "./date-math.js";

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
  { eventId, through, message }), whose later or backdated firing could change the
  answer — and a \`breakdown\`: each clause's own tranches and blockers, for when
  you need to see which clause produced what.
- Tranche array → vestlang: call vestlang_infer_schedule on an array of
  {date, amount} pairs to get the best-fit DSL (branch-and-bound
  minimum-cardinality exact cover). Note that the returned diagnostics.vestingDayOfMonth is not
  encoded in the DSL — pass it back as EvaluationContext when evaluating the
  returned DSL.

Dates are YYYY-MM-DD. Statements that reference named events (e.g.
EVENT "ipo") require those events to appear in the events map — otherwise the
schedule comes back pending: it carries blockers naming the unfired event, an empty or
partial projection, and (when the event was compared against a date) an entry in
absenceAssumptions. A comparison against an unfired event is pending, never silently
satisfied or impossible — the event could still be recorded later, even backdated.

When parse/compile/evaluate fail they don't throw — they return a structured
{ error: { ruleId, message, loc? } }: ruleId is "syntax-error" (carrying loc,
the source span) for malformed DSL, or "evaluation-error" for a problem hit
during evaluation (e.g. a schedule too large to materialize). Check for an
\`error\` field on the result before reading the rest.`;

/* ------------------------
 * Shared Zod schemas
 * ------------------------ */

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD")
  .refine(isValidCalendarDate, "must be a real calendar date (YYYY-MM-DD)");

// Consumes the canonical value array from @vestlang/types rather than re-spelling
// the 32 codes here — a dropped or renamed entry fails typecheck at the source.
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
    .describe("Total shares granted"),
  events: z
    .record(z.string().min(1), ISO_DATE)
    .optional()
    .describe(
      `Named events referenced by the DSL, e.g. {"ipo": "2027-06-01"}. grantDate is set automatically.`,
    ),
  vesting_day_of_month: VESTING_DAY_OF_MONTH.optional().describe(
    "OCT VestingDayOfMonth. Defaults to VESTING_START_DAY_OR_LAST_DAY_OF_MONTH.",
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
        "Parse vestlang DSL text into a raw AST (RawProgram). Errors return a structured syntax diagnostic with source location.",
      inputSchema: z.object({ dsl: DSL_INPUT }).strict().shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ dsl }) => {
      const result = parseRaw(dsl);
      if (!result.ok) return jsonResult({ error: result.error });
      return jsonResult({ ast: result.ast });
    },
  );

  /* compile: DSL → normalized AST */
  server.registerTool(
    "vestlang_compile",
    {
      title: "Compile vestlang to normalized AST",
      description:
        "Parse vestlang DSL text and produce the normalized canonical AST (Program). Use this when reasoning about the structure of a schedule; it is the same shape the evaluator consumes.",
      inputSchema: z.object({ dsl: DSL_INPUT }).strict().shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ dsl }) => {
      const result = parseToProgram(dsl);
      if (!result.ok) return jsonResult({ error: result.error });
      return jsonResult({ program: result.program });
    },
  );

  /* stringify: AST → DSL source text */
  server.registerTool(
    "vestlang_stringify",
    {
      title: "Stringify AST to vestlang",
      description:
        "Convert a vestlang AST (either a Statement or a Program array) back into DSL source text. Useful for round-tripping or presenting a machine-generated schedule as canonical vestlang.",
      inputSchema: z
        .object({
          ast: z
            .unknown()
            .describe(
              "A vestlang Statement or Program (array of Statements). Typically obtained from vestlang_compile.",
            ),
        })
        .strict().shape,
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
        return jsonResult({ dsl: text });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(
          `Stringify failed: ${msg}. Pass a Statement or Program from vestlang_compile.`,
        );
      }
    },
  );

  /* infer_schedule: {date, amount}[] → DSL via branch-and-bound exact cover */
  server.registerTool(
    "vestlang_infer_schedule",
    {
      title: "Infer vestlang from tranche array",
      description:
        "Reverse of vestlang_evaluate: take an array of {date, amount} vesting tranches and return the best-fit vestlang DSL source. Decomposes the stream by branch-and-bound minimum-cardinality exact cover — the fewest uniform trains, cliffs, and one-off pulses that reproduce it (a greedy seed sets the bound, then the search tries to beat it), with a cliff fold-up post-pass; anything unexplained becomes single-date statements. Always round-trip verified: the returned DSL, when evaluated with the reported vestingDayOfMonth, reproduces the input. IMPORTANT: the returned diagnostics.vestingDayOfMonth is NOT encoded in the DSL itself — consumers who later call vestlang_evaluate on the returned DSL must pass it back as EvaluationContext, or they will get a slightly different schedule.",
      inputSchema: z
        .object({
          tranches: z
            .array(
              z
                .object({
                  date: ISO_DATE,
                  amount: z
                    .number()
                    .int("tranche amount must be a whole number")
                    .min(0, "tranche amount must be non-negative")
                    .describe("Tranche amount (not cumulative)"),
                })
                .strict(),
            )
            .min(1, "tranches must contain at least one entry")
            .describe(
              "Array of {date, amount} vesting tranches. Same-date tranches are summed.",
            ),
          grant_date: ISO_DATE.optional().describe(
            "Optional grant date anchor. If omitted, defaults to the first tranche date.",
          ),
        })
        .strict().shape,
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
        return jsonResult(result);
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
        'Evaluate a vestlang program against a grant context. The program is treated as ONE grant: its statements collapse into a single schedule of installments (RESOLVED / UNRESOLVED / IMPOSSIBLE) with blockers, and you get TWO verdicts on it. `interchange` — the storable verdict, what a record keeper could hold, computed WITHOUT reading firings: "template" (fits one canonical template), "events-only" (resolves to dated amounts but cannot be one template — e.g. two overlapping independent absolute starts — with a `reason`), "unrepresentable" (no storable form even as bare events — today only an event-anchored cliff), or "impossible" (a structural contradiction). `resolution` — the resolves-to verdict given the events you passed: "template", "events-only", "unresolved" (pending on an unfired event), or "impossible". The two can differ — a gated start is a storable `template` that may resolve to `impossible` after an early firing. Also returns `representable` (from `interchange`), `pending` (witnesses still missing — a `template` can be pending, so read pending from this flag / `blockers`, never from a verdict status), and `valid` (false when the program allocates more than the grant) with a single `findings` array (each `kind`, `severity`, exact `sum`, human `message`) computed over the whole program; installments are still returned when `valid` is false but aren\'t a valid schedule. It carries `absenceAssumptions` (events the resolves-to reading assumes stayed absent, each { eventId, through, message }, whose later or backdated firing could change the result), and `breakdown` — one entry per clause (a THEN chain reports as one entry, since its segments can\'t be placed apart) with that clause\'s own installments and blockers (no verdict; a clause has no storable schedule of its own), for attribution. Does not filter by date — use vestlang_evaluate_as_of for a point-in-time view.',
      inputSchema: z
        .object({
          dsl: DSL_INPUT,
          ...EVAL_CONTEXT_FIELDS,
        })
        .strict().shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = runEvaluate(params.dsl, toGrant(params));
      if (!result.ok) return jsonResult({ error: result.error });
      // The view carries the verdicts and published fields; the breakdown rides
      // alongside, and on a rescue so does the recovered block (events-only
      // reason + inferred DSL).
      return jsonResult({
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
        "Partition the grant's installments into {vested, unvested, impossible} with an unresolved count (shares not yet schedulable), as of a given date (defaults to today), plus a `summary` roll-up (total vested/unvested, percent vested, next vest, fully-vested date, cliff). The program is collapsed into one schedule first, so this is the grant-wide answer to 'how much is vested right now?'. For the verdicts and storability flags, use vestlang_evaluate.",
      inputSchema: z
        .object({
          dsl: DSL_INPUT,
          ...EVAL_CONTEXT_FIELDS,
          as_of: ISO_DATE.optional().describe(
            "As-of date (YYYY-MM-DD). Defaults to today.",
          ),
        })
        .strict().shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = runAsOf(params.dsl, toGrant(params), params.as_of);
      if (!result.ok) return jsonResult({ error: result.error });
      return jsonResult({
        as_of: result.asOf,
        vested: result.vested,
        unvested: result.unvested,
        impossible: result.impossible,
        unresolved: result.unresolved,
        summary: result.summary,
      });
    },
  );

  /* vested_between: DSL + context + window → installments within [from, to] */
  server.registerTool(
    "vestlang_vested_between",
    {
      title: "Vested shares in a date window",
      description:
        "Return the grant's RESOLVED installments whose vest date falls within [from, to] (inclusive), along with the sum. Use this for questions like 'how much vested in H2 2025?' or 'how many tranches released between 2025-01-01 and 2025-12-31?'. The program is collapsed into one schedule first; UNRESOLVED and IMPOSSIBLE installments are excluded — they haven't vested.",
      inputSchema: z
        .object({
          dsl: DSL_INPUT,
          ...EVAL_CONTEXT_FIELDS,
          from: ISO_DATE.describe("Window start, inclusive (YYYY-MM-DD)"),
          to: ISO_DATE.describe("Window end, inclusive (YYYY-MM-DD)"),
        })
        .strict().shape,
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
      if (!result.ok) return jsonResult({ error: result.error });
      return jsonResult({
        from: result.from,
        to: result.to,
        vested_in_window: result.vested_in_window,
        tranches_in_window: result.tranches_in_window,
        installments: result.installments,
      });
    },
  );

  /* lint: DSL → diagnostics (syntax + semantic) */
  server.registerTool(
    "vestlang_lint",
    {
      title: "Lint vestlang",
      description:
        "Run vestlang's syntax and semantic linter against DSL text. Returns a list of diagnostics, each with ruleId, severity, message, and (when available) source location. An empty diagnostics array means the program is valid.",
      inputSchema: z.object({ dsl: DSL_INPUT }).strict().shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ dsl }) => {
      const { diagnostics } = lintText(dsl, parse);
      return jsonResult({
        ok: diagnostics.length === 0,
        diagnostics,
      });
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
      inputSchema: z
        .object({
          date: ISO_DATE.describe("Starting date (YYYY-MM-DD)"),
          length: z.number().int("length must be a whole number"),
          unit: PERIOD_UNIT,
          vesting_day_of_month: VESTING_DAY_OF_MONTH.optional().describe(
            "Only applies to months/years. Defaults to VESTING_START_DAY_OR_LAST_DAY_OF_MONTH.",
          ),
        })
        .strict().shape,
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
        rule ?? "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      );
      return jsonResult({ date: result });
    },
  );

  server.registerTool(
    "vestlang_date_diff",
    {
      title: "Difference between two dates",
      description:
        "Count the calendar days or whole calendar months between two dates. For months, also returns remainder_days (days from the anchor month-boundary to 'to'). Direction is signed: if 'to' is before 'from', the diff is negative.",
      inputSchema: z
        .object({
          from: ISO_DATE,
          to: ISO_DATE,
          unit: z.enum(["days", "months"]),
        })
        .strict().shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ from, to, unit }) => {
      const result = dateDiff(from, to, unit);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "vestlang_resolve_offset",
    {
      title: "Resolve an offset expression to a date",
      description:
        "Resolve a vestlang offset expression (e.g. 'EVENT ipo + 6 months', '+3 months', 'DATE 2025-01-01 - 2 days', 'EARLIER OF (EVENT a, EVENT b)') to a concrete date. Requires grant_date (used for expressions that reference the grant anchor). Named events used in the expression must be in the events map.",
      inputSchema: z
        .object({
          expr: z
            .string()
            .min(1)
            .describe(
              "Offset expression as it would appear after 'VEST FROM' in the DSL.",
            ),
          grant_date: ISO_DATE,
          events: z.record(z.string().min(1), ISO_DATE).optional(),
          vesting_day_of_month: VESTING_DAY_OF_MONTH.optional(),
        })
        .strict().shape,
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
      const result = resolveOffset({
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
        "Apply a VestingDayOfMonth rule to the given date's year+month and return the rule's picked day. Useful for questions like 'what does 29_OR_LAST_DAY_OF_MONTH mean for Feb 2026?' — answer: 2026-02-28. Does not cross months.",
      inputSchema: z
        .object({
          date: ISO_DATE,
          rule: VESTING_DAY_OF_MONTH,
        })
        .strict().shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ date, rule }) => {
      const result = resolveVestingDay(date, rule);
      return jsonResult({ date: result });
    },
  );

  return server;
}
