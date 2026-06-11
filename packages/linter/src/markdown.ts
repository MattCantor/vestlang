// Lint the vestlang DSL inside Markdown ```vest fenced code blocks.
//
// Reuses `lintText` (parse + normalize + semantic rules; syntax errors already
// carry a source `loc`) and maps each diagnostic back to an absolute line/column
// in the Markdown file. Syntax errors get exact positions (`precise: true`);
// semantic findings carry only an AST path, so they anchor to the block's first
// line (`precise: false`). Consumers (the CLI editor format, CI) decide what to
// surface by precision.

import { lintText } from "./index.js";
import type { Diagnostic, DiagnosticSeverity } from "./types.js";

export interface MarkdownDiagnostic {
  ruleId: string;
  message: string;
  severity: DiagnosticSeverity;
  /** 1-based line, absolute in the Markdown file. */
  line: number;
  /** 1-based column, absolute in the Markdown file. */
  column: number;
  /** true = exact position (syntax error); false = anchored to the block start. */
  precise: boolean;
  codeFrame?: string;
}

interface VestBlock {
  /** 1-based line of the first content line inside the fence. */
  startLine: number;
  /** leading indentation of the fence, used to dedent and re-offset columns. */
  indent: number;
  text: string;
  ignored: boolean;
}

const FENCE_OPEN = /^(\s*)```vest\b.*$/;
const FENCE_CLOSE = /^\s*```\s*$/;
const IGNORE_RE = /<!--\s*vest-lint-ignore\s*-->/;

function dedent(textLines: string[], indent: number): string {
  if (indent === 0) return textLines.join("\n");
  return textLines
    .map((l) =>
      l.length >= indent && l.slice(0, indent).trim() === ""
        ? l.slice(indent)
        : l.replace(/^\s+/, ""),
    )
    .join("\n");
}

function extractBlocks(source: string): VestBlock[] {
  const lines = source.split("\n");
  const blocks: VestBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) {
      i++;
      continue;
    }
    const indent = open[1].length;

    // An <!-- vest-lint-ignore --> on the nearest preceding non-blank line skips
    // the block (escape hatch for deliberately-invalid examples).
    let ignored = false;
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].trim() === "") continue;
      ignored = IGNORE_RE.test(lines[j]);
      break;
    }

    const contentStart = i + 1; // 0-based index of first content line
    let k = contentStart;
    while (k < lines.length && !FENCE_CLOSE.test(lines[k])) k++;

    blocks.push({
      startLine: contentStart + 1, // 1-based
      indent,
      text: dedent(lines.slice(contentStart, k), indent),
      ignored,
    });
    i = k + 1;
  }
  return blocks;
}

const isOnlySyntaxError = (diags: Diagnostic[]): boolean =>
  diags.length > 0 && diags.every((d) => d.ruleId === "syntax-error");

const parsesClean = (src: string): boolean =>
  !lintText(src).diagnostics.some((d) => d.ruleId === "syntax-error");

// A block of one or more bare anchor/offset fragments (e.g. "EVENT ipo + 6 months"),
// rather than a runnable program. True if the whole block — or every non-blank line
// — parses once wrapped as a `VEST FROM` start.
function isFragmentBlock(text: string): boolean {
  if (parsesClean("VEST FROM " + text.trim())) return true;
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return lines.length > 0 && lines.every((l) => parsesClean("VEST FROM " + l));
}

export function lintMarkdown(source: string): MarkdownDiagnostic[] {
  const out: MarkdownDiagnostic[] = [];

  for (const block of extractBlocks(source)) {
    if (block.ignored || block.text.trim() === "") continue;

    const { diagnostics } = lintText(block.text);

    // Fragment fallback: a block that won't parse as a program may be one or
    // more bare anchor/offset fragments. If so, treat it as valid illustrative
    // syntax and skip it.
    if (isOnlySyntaxError(diagnostics) && isFragmentBlock(block.text)) {
      continue;
    }

    for (const d of diagnostics) {
      if (d.loc) {
        out.push({
          ruleId: d.ruleId,
          message: d.message,
          severity: d.severity,
          line: block.startLine + d.loc.start.line - 1,
          column: d.loc.start.column + block.indent,
          precise: true,
          codeFrame: d.codeFrame,
        });
      } else {
        out.push({
          ruleId: d.ruleId,
          message: d.message,
          severity: d.severity,
          line: block.startLine,
          column: 1 + block.indent,
          precise: false,
        });
      }
    }
  }

  return out;
}
