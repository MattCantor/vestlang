import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import {
  evaluateStatement,
  evaluateStatementAsOf,
} from "@vestlang/evaluator";
import { lintText } from "@vestlang/linter";
import { stringify } from "@vestlang/stringify";
import type {
  EvaluationContextInput,
  OCTDate,
  Program,
  Statement,
} from "@vestlang/types";
import { registerResources } from "./resources.js";

const INSTRUCTIONS = `Vestlang is a DSL for equity vesting schedules. This server
exposes the full vestlang pipeline (parse, compile, evaluate, lint, stringify)
as tools, and publishes the grammar/spec/examples as resources.

Typical workflows:
- Natural language → vestlang: fetch the vestlang://docs/grammar and
  vestlang://examples/valid-statements resources, compose a statement, then
  validate with vestlang_lint before showing it.
- Vestlang → plain English: call vestlang_compile to inspect the normalized
  AST, then explain it to the user.
- Scenario modeling: call vestlang_evaluate or vestlang_evaluate_as_of with
  a grant_date, grant_quantity, and any named events that the DSL references.

Dates are YYYY-MM-DD. Statements that reference named events (e.g.
EVENT "ipo") require those events to appear in the events map — otherwise
installments gated on them will come back as UNRESOLVED with blockers.`;

/* ------------------------
 * Shared Zod schemas
 * ------------------------ */

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD");

const VESTING_DAY_OF_MONTH = z.enum([
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "21", "22", "23", "24", "25", "26", "27", "28",
  "29_OR_LAST_DAY_OF_MONTH",
  "30_OR_LAST_DAY_OF_MONTH",
  "31_OR_LAST_DAY_OF_MONTH",
  "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
]);

const ALLOCATION_TYPE = z.enum([
  "CUMULATIVE_ROUNDING",
  "CUMULATIVE_ROUND_DOWN",
  "FRONT_LOADED",
  "BACK_LOADED",
  "FRONT_LOADED_TO_SINGLE_TRANCHE",
  "BACK_LOADED_TO_SINGLE_TRANCHE",
]);

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
    "OCT vesting_day_of_month. Defaults to VESTING_START_DAY_OR_LAST_DAY_OF_MONTH.",
  ),
  allocation_type: ALLOCATION_TYPE.optional().describe(
    "OCT allocation_type. Defaults to CUMULATIVE_ROUND_DOWN.",
  ),
};

/* ------------------------
 * Helpers
 * ------------------------ */

function today(): OCTDate {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}` as OCTDate;
}

function buildContext(input: {
  grant_date: string;
  grant_quantity: number;
  events?: Record<string, string>;
  as_of?: string;
  vesting_day_of_month?: z.infer<typeof VESTING_DAY_OF_MONTH>;
  allocation_type?: z.infer<typeof ALLOCATION_TYPE>;
}): EvaluationContextInput {
  const events: Record<string, OCTDate> = {};
  for (const [name, date] of Object.entries(input.events ?? {})) {
    events[name] = date as OCTDate;
  }
  events.grantDate = input.grant_date as OCTDate;
  return {
    events: events as EvaluationContextInput["events"],
    grantQuantity: input.grant_quantity,
    asOf: (input.as_of ?? today()) as OCTDate,
    vesting_day_of_month:
      input.vesting_day_of_month ?? "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    allocation_type: input.allocation_type ?? "CUMULATIVE_ROUND_DOWN",
  };
}

type ParseError = {
  ruleId: "syntax-error";
  message: string;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
};

function parseWithDiagnostics(
  dsl: string,
):
  | { ok: true; program: Program }
  | { ok: false; error: ParseError } {
  try {
    const raw = parse(dsl);
    return { ok: true, program: normalizeProgram(raw) };
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string; location?: any };
    if (e?.name === "SyntaxError" && e.location) {
      return {
        ok: false,
        error: {
          ruleId: "syntax-error",
          message: e.message ?? "Syntax error",
          loc: {
            start: {
              line: e.location.start.line,
              column: e.location.start.column,
            },
            end: {
              line: e.location.end.line,
              column: e.location.end.column,
            },
          },
        },
      };
    }
    return {
      ok: false,
      error: {
        ruleId: "syntax-error",
        message: e?.message ?? String(err),
      },
    };
  }
}

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function jsonResult<T>(output: T) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(output, null, 2) },
    ],
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
      try {
        const raw = parse(dsl);
        return jsonResult({ ast: raw });
      } catch (err: unknown) {
        const e = err as { name?: string; message?: string; location?: any };
        if (e?.name === "SyntaxError" && e.location) {
          return jsonResult({
            error: {
              ruleId: "syntax-error",
              message: e.message,
              loc: e.location,
            },
          });
        }
        return toolError(
          `Parse failed: ${e?.message ?? String(err)}`,
        );
      }
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
      const result = parseWithDiagnostics(dsl);
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
        const text = stringify(ast as Statement | Program);
        return jsonResult({ dsl: text });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(
          `Stringify failed: ${msg}. Pass a Statement or Program from vestlang_compile.`,
        );
      }
    },
  );

  /* evaluate: DSL + context → full schedule of installments per statement */
  server.registerTool(
    "vestlang_evaluate",
    {
      title: "Evaluate vesting schedule",
      description:
        "Evaluate vestlang against a grant context and return every installment (RESOLVED, UNRESOLVED, or IMPOSSIBLE) for each statement along with any blockers. Does not filter by date — use vestlang_evaluate_as_of for a point-in-time view.",
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
      const parsed = parseWithDiagnostics(params.dsl);
      if (!parsed.ok) return jsonResult({ error: parsed.error });
      const ctx = buildContext(params);
      const schedules = parsed.program.map((stmt) =>
        evaluateStatement(stmt, ctx),
      );
      return jsonResult({
        statements: schedules.map((s, i) => ({
          index: i,
          installments: s.installments,
          blockers: s.blockers,
        })),
      });
    },
  );

  /* evaluate_as_of: DSL + context + asOf date → vested / unvested / impossible / unresolved */
  server.registerTool(
    "vestlang_evaluate_as_of",
    {
      title: "Evaluate vesting as of a date",
      description:
        "Evaluate vestlang and partition installments into {vested, unvested, impossible} with an unresolved count, as of a given date (defaults to today). This is the primary tool for answering 'how much is vested right now?' questions.",
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
      const parsed = parseWithDiagnostics(params.dsl);
      if (!parsed.ok) return jsonResult({ error: parsed.error });
      const ctx = buildContext(params);
      const results = parsed.program.map((stmt) =>
        evaluateStatementAsOf(stmt, ctx),
      );
      return jsonResult({
        as_of: ctx.asOf,
        statements: results.map((r, i) => ({
          index: i,
          vested: r.vested,
          unvested: r.unvested,
          impossible: r.impossible,
          unresolved: r.unresolved,
        })),
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

  return server;
}
