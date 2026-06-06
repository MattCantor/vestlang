import { Program, RawProgram } from "@vestlang/types";
import { walk, type AstNode } from "@vestlang/walk";
import {
  Diagnostic,
  LintContext,
  LintResult,
  NodePath,
  RuleModule,
  SourcePosition,
} from "./types.js";
import { stableKey } from "./utils.js";
import { buildInRules } from "./rules/index.js";
import { normalizeProgram } from "@vestlang/normalizer";

export interface LintOptions {
  rules?: Array<RuleModule>;
}

// Every node-level hook has this shape once we've forgotten which exact node
// kind it subscribed to — which is all the driver needs to fan a node out to it.
type NodeHook = (node: AstNode, path: NodePath) => void;

export function lintProgram(
  program: Program,
  opts: LintOptions = {},
): LintResult {
  const diagnostics: Diagnostic[] = [];

  const ctx: LintContext = {
    report: (d) => diagnostics.push(d),
    stableKey,
  };

  const visitors = (opts.rules ?? Array.from(buildInRules)).map((r) =>
    r.create(ctx),
  );

  // Program-level rules look at the whole statement list at once. The shared
  // walk only ever hands us individual nodes (a program is a bare array, not a
  // node), so these hooks are driven separately, up front.
  for (const v of visitors) v.Program?.(program);

  // Everything else: walk each statement and, at every node, invoke whichever
  // rules subscribed to that node's `type`. The walk owns the recursion; rules
  // only say which kinds they care about. `["Program", i]` seeds the path so
  // diagnostics point at `["Program", i, "expr", …]`.
  const dispatch = (node: AstNode, path: NodePath) => {
    for (const v of visitors) {
      const hook = (v as Record<string, NodeHook | undefined>)[node.type];
      hook?.(node, path);
    }
  };
  program.forEach((stmt, i) => walk(stmt, dispatch, ["Program", i]));

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
  } catch (err: unknown) {
    const e = err as {
      name?: string;
      message?: string;
      location?: {
        start: { line: number; column: number };
        end: { line: number; column: number };
      };
    };
    if (e.name === "SyntaxError" && e.location) {
      const diagnostic: Diagnostic = {
        ruleId: "syntax-error",
        message: e.message ?? "Syntax error",
        severity: "error",
        path: [],
        loc: {
          start: {
            line: e.location.start.line,
            column: e.location.start.column,
          },
          end: { line: e.location.end.line, column: e.location.end.column },
        },
        codeFrame: buildCodeFrame(source, e.location),
      };
      return { diagnostics: [diagnostic] };
    }

    // Non-peggy errors - surface as generic diagnostic
    const diagnostic: Diagnostic = {
      ruleId: "unexpected-error",
      message: String(e.message ?? err),
      severity: "error",
      path: [],
    };
    return { diagnostics: [diagnostic] };
  }
}

export * from "./types.js";
export * from "./markdown.js";
