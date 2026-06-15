import { Program } from "@vestlang/types";
import { walk, type AstNode } from "@vestlang/walk";
import {
  Diagnostic,
  DiagnosticSeverity,
  LintContext,
  LintResult,
  NodePath,
  SourcePosition,
} from "./types.js";
import { stableKey } from "@vestlang/utils";
import { buildInRules } from "./rules/index.js";
import { normalizeProgram } from "@vestlang/normalizer";
import { parse, asParseFailure } from "@vestlang/dsl";

// Every node-level hook has this shape once we've forgotten which exact node
// kind it subscribed to — which is all the driver needs to fan a node out to it.
type NodeHook = (node: AstNode, path: NodePath) => void;

export function lintProgram(program: Program): LintResult {
  const diagnostics: Diagnostic[] = [];

  const ctx: LintContext = {
    report: (d) => diagnostics.push(d),
    stableKey,
  };

  const visitors = Array.from(buildInRules).map((r) => r.create(ctx));

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

export function lintText(source: string): LintResult {
  try {
    const raw = parse(source);
    // The normalizer dedupes duplicate selector arms (and the like) as part of
    // canonicalization. It reports each drop through this sink so we can surface
    // it — the catch the dead `no-duplicate-selector-items` rule couldn't make,
    // because by the time `lintProgram` sees a normalized program the duplicates
    // are already gone. (`lintProgram` on its own never produces these.)
    const fromNormalizer: Diagnostic[] = [];
    const canonical = normalizeProgram(raw, (d) => fromNormalizer.push(d));
    const { diagnostics } = lintProgram(canonical);
    return { diagnostics: [...fromNormalizer, ...diagnostics] };
  } catch (err: unknown) {
    // `@vestlang/dsl` owns the thrown-error shape. A located peggy syntax error
    // decodes to a `ParseFailure`; we render it (loc + code frame, built from the
    // decoded loc, not the raw throw). Anything else falls through to the generic
    // `unexpected-error` arm — that label is load-bearing in `markdown.ts`.
    const failure = asParseFailure(err);
    if (failure) {
      const diagnostic: Diagnostic = {
        ruleId: "syntax-error",
        message: failure.message,
        severity: "error",
        path: [],
        loc: failure.loc,
        codeFrame: buildCodeFrame(source, failure.loc),
      };
      return { diagnostics: [diagnostic] };
    }

    // Non-peggy errors - surface as generic diagnostic
    const diagnostic: Diagnostic = {
      ruleId: "unexpected-error",
      message: String((err as { message?: string })?.message ?? err),
      severity: "error",
      path: [],
    };
    return { diagnostics: [diagnostic] };
  }
}

// The single definition of which lint diagnostics block. Only error severity
// counts; warnings and info are advisory, so they fall away here. Generic over
// any severity-bearing shape — a `Diagnostic`, a `MarkdownDiagnostic`, or a bare
// `{ severity }` stub — and returns the same element type, so a caller keeps
// whatever fields it had (persist still reads `.ruleId`/`.message` off the
// result). Sibling of `errorFindings` over `Finding[]` in the pipeline.
export function errorDiagnostics<T extends { severity: DiagnosticSeverity }>(
  ds: T[],
): T[] {
  return ds.filter((d) => d.severity === "error");
}

export * from "./types.js";
export * from "./markdown.js";
