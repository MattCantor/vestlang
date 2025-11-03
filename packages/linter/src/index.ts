import { Program, RawProgram } from "@vestlang/types";
import {
  Diagnostic,
  LintContext,
  LintResult,
  RuleModule,
  SourcePosition,
} from "./types.js";
import { stableKey } from "./utils.js";
import { buildInRules } from "./rules/index.js";
import { walkProgram } from "./walker.js";
import { normalizeProgram } from "@vestlang/normalizer";

export interface LintOptions {
  rules?: Array<RuleModule>;
}

export function lintProgram(
  program: Program,
  opts: LintOptions = {},
): LintResult {
  const diagnostics: Diagnostic[] = [];

  const ctx: LintContext = {
    report: (d) => diagnostics.push(d),
    stableKey,
  };

  const rules = (opts.rules ?? Array.from(buildInRules)).map((r) => ({
    mod: r,
    visitor: r.create(ctx),
  }));

  // Compose visitors: for each walker hook, call all rule visitors
  const composed = new Proxy(
    {},
    {
      get(_t, prop: string) {
        return (...args: any[]) => {
          for (const r of rules) {
            const fn = (r.visitor as any)[prop];
            if (typeof fn === "function") fn.apply(r.mod, args);
          }
        };
      },
    },
  );

  walkProgram(program, composed);
  return { diagnostics };
}

function buildCodeFrame(source: string, loc: { start: SourcePosition }) {
  const lines = source.split("\n");
  const line = lines[loc.start.line - 1] ?? "";
  const caret = " ".repeat(Math.max(0, loc.start.column - 1)) + "^";
  return `${line}\n${caret}`;
}

export function lintText(
  source: string,
  parseVestlang: (text: string) => unknown,
  opts: LintOptions = {},
): LintResult {
  try {
    const raw = parseVestlang(source) as RawProgram;
    const canonical = normalizeProgram(raw);
    return lintProgram(canonical, opts);
  } catch (err: any) {
    if (err?.name === "SyntaxError" && err?.location) {
      const diagnostic: Diagnostic = {
        ruleId: "syntax-error",
        message: err.message,
        severity: "error",
        path: [],
        loc: {
          start: {
            line: err.location.start.line,
            column: err.location.start.column,
          },
          end: { line: err.location.end.line, column: err.location.end.column },
        },
        codeFrame: buildCodeFrame(source, err.location),
      };
      return { diagnostics: [diagnostic] };
    }

    // Non-peggy errors - surface as generic diagnostic
    const diagnostic: Diagnostic = {
      ruleId: "unexpected-error",
      message: String(err?.message ?? err),
      severity: "error",
      path: [],
    };
    return { diagnostics: [diagnostic] };
  }
}

export * from "./types.js";
