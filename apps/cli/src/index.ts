#!/usr/bin/env node
import { Command } from "commander";
import { inspect } from "./inspect.js";
import { compile } from "./compile.js";
import { asof } from "./asof.js";
import { evaluate } from "./evaluate.js";
import { lint } from "./lint.js";
import { parseEvent } from "./utils.js";

const program = new Command();

program.name("vest").description("Vestlang CLI").version("0.1.0");

// One boundary around the command actions: anything that still throws (a stray
// engine error, a bug) becomes a single `error:` line and a non-zero exit,
// never a raw Node stack trace leaking file paths. Known pipeline failures are
// already presented by `fail` inside the actions; this catches the rest.
function withBoundary(action: () => void): void {
  try {
    action();
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/* ------------------------
 * Inspect
 * ------------------------ */

// vestlang inspect [input...] [--stdin]
program
  .command("inspect")
  .description("Produce raw AST from statement")
  .argument("[input...]", "DSL text")
  .option("--stdin", "read input from stdin")
  .action((parts: string[] = [], opts: { stdin?: boolean }) => {
    withBoundary(() => inspect(parts, opts));
  });

/* ------------------------
 * Compile
 * ------------------------ */

// vestlang compile [input...] [--stdin]
program
  .command("compile")
  .description("Produce normalized AST from statement")
  .argument("[input...]", "DSL text")
  .option("--stdin", "read input from stdin")
  .action((parts: string[] = [], opts: { stdin?: boolean }) => {
    withBoundary(() => compile(parts, opts));
  });

/* ------------------------
 * As Of
 * ------------------------ */

program
  .command("asOf")
  .description("Evaluate vesting as of a specific date.")
  .requiredOption("-q, --quantity <number>", "total number of shares granted")
  .requiredOption("-g, --grantDate <string>", "grant date of the award")
  .option("-d, --date <YYYY-MM-DD>", "as-of date in YYYY-MM-DD format")
  .option(
    "-e, --event <NAME=YYYY-MM-DD>",
    "add an event (repeatable), e.g. --event ipo=2025-01-01",
    parseEvent,
    {} as Record<string, string>,
  )
  .option("--stdin", "read input from stdin")
  .argument("[input...]", "DSL text")
  .action(
    (
      parts: string[],
      opts: {
        quantity: string;
        grantDate: string;
        date?: string;
        event: Record<string, string>;
        stdin?: boolean;
      },
    ) => {
      withBoundary(() => asof(parts, opts));
    },
  );

/* ------------------------
 * Evaluate
 * ------------------------ */

program
  .command("evaluate")
  .description("Evaluate the vesting schedule with metadata")
  .requiredOption("-q, --quantity <number>", "total number of shares granted")
  .requiredOption("-g, --grantDate <string>", "grant date of the award")
  .option(
    "-e, --event <NAME=YYYY-MM-DD>",
    "add an event (repeatable), e.g. --event milestone=2025-01-01",
    parseEvent,
    {} as Record<string, string>,
  )
  .option("--stdin", "read input from stdin")
  .argument("[input...]", "DSL text")
  .action(
    (
      parts: string[],
      opts: {
        quantity: string;
        grantDate: string;
        event: Record<string, string>;
        stdin?: boolean;
      },
    ) => {
      withBoundary(() => evaluate(parts, opts));
    },
  );

program
  .command("lint")
  .description("Lint vestlang source and report syntax/semantic issues")
  .option("--stdin", "read input from stdin")
  .option("--markdown <file>", "lint the ```vest blocks in a markdown file")
  .option(
    "--format <fmt>",
    "output format for --markdown: pretty (default) or editor",
    "pretty",
  )
  .argument("[input...]", "DSL text")
  .action(
    (
      parts: string[] = [],
      opts: { stdin?: boolean; markdown?: string; format?: string },
    ) => {
      lint(parts, opts);
    },
  );

void program.parseAsync();
