import { Diagnostic, lintText, lintMarkdown } from "@vestlang/linter";
import type { MarkdownDiagnostic } from "@vestlang/linter";
import { input } from "./utils.js";
import { parse } from "@vestlang/dsl";
import { readFileSync } from "node:fs";

function prettyPrint(diagnostics: Diagnostic[]) {
  if (diagnostics.length === 0) {
    console.log("No problems found.");
    return;
  }

  for (const d of diagnostics) {
    const where = d.loc
      ? `(${d.loc.start.line}:${d.loc.start.column})`
      : d.path.length
        ? `@ ${d.path.join(".")}`
        : "";
    console.log(`${d.severity}: ${d.ruleId} ${where}\n ${d.message}`);
    if (d.codeFrame) {
      console.log("\n" + d.codeFrame + "\n");
    } else {
      console.log();
    }
  }
}

// Human-readable view of markdown-block diagnostics (everything, with file:line:col).
function prettyPrintMarkdown(file: string, diags: MarkdownDiagnostic[]) {
  if (diags.length === 0) {
    console.log("No problems found.");
    return;
  }
  for (const d of diags) {
    console.log(
      `${d.severity}: ${d.ruleId} (${file}:${d.line}:${d.column})\n ${d.message}`,
    );
    console.log(d.codeFrame ? "\n" + d.codeFrame + "\n" : "");
  }
}

// Machine format for editors (nvim-lint). Only precise (loc-bearing, i.e. syntax)
// diagnostics, so on-save inline markers land on the exact line.
//   <file>:<line>:<col>: <severity>: <ruleId>: <message>
function editorPrintMarkdown(file: string, diags: MarkdownDiagnostic[]) {
  for (const d of diags) {
    if (!d.precise) continue;
    const msg = d.message.replace(/\s+/g, " ").trim();
    console.log(
      `${file}:${d.line}:${d.column}: ${d.severity}: ${d.ruleId}: ${msg}`,
    );
  }
}

export function lint(
  parts: string[] = [],
  opts: { stdin?: boolean; markdown?: string; format?: string },
): void {
  // Markdown mode: lint the ```vest blocks in a file.
  if (opts.markdown) {
    const file = opts.markdown;
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch (e) {
      console.error(`cannot read ${file}: ${(e as Error).message}`);
      process.exit(2);
    }
    const diags = lintMarkdown(src, parse);
    if (opts.format === "editor") {
      editorPrintMarkdown(file, diags);
      process.exit(0); // diagnostics are in stdout; editors read them there
    }
    prettyPrintMarkdown(file, diags);
    process.exit(diags.some((d) => d.severity === "error") ? 1 : 0);
  }

  // Default: lint a DSL string (args or stdin).
  const src = input(parts, opts.stdin);
  const { diagnostics } = lintText(src, parse);
  prettyPrint(diagnostics);
  process.exit(diagnostics.length ? 1 : 0);
}
