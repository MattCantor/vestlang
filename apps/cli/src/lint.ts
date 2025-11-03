import { Diagnostic, lintText } from "@vestlang/linter";
import { input } from "./utils.js";
import { parse } from "@vestlang/dsl";

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

export function lint(parts: string[] = [], opts: { stdin?: boolean }): void {
  const src = input(parts, opts.stdin);
  const { diagnostics } = lintText(src, parse);
  prettyPrint(diagnostics);
  process.exit(diagnostics.length ? 1 : 0);
}
