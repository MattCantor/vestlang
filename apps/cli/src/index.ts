#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { inspect } from "./inspect.js";
import { compile } from "./compile.js";
import { asof } from "./asof.js";
// import { expand } from "./expand.js";
import { evaluate } from "./evaluate.js";

const program = new Command();

program.name("vest").description("Vestlang CLI").version("0.1.0");

/* ------------------------
 * Inspect
 * ------------------------ */

// vestlang inspect [input...] [--stdin]
program
  .command("inspect")
  .argument("[input...]", "DSL text")
  .option("--stdin", "read input from stdin")
  .action((parts: string[] = [], opts: { stdin?: boolean }) => {
    inspect(parts, opts);
  });

/* ------------------------
 * Compile
 * ------------------------ */

// vestlang compile [input...] [--stdin]
program
  .command("compile")
  .argument("[input...]", "DSL text")
  .option("--stdin", "read input from stdin")
  .action((parts: string[] = [], opts: { stdin?: boolean }) => {
    compile(parts, opts);
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
  .option("--stdin", "read input from stdin")
  .argument("[input...]", "DSL text")
  .action(
    (
      parts: string[],
      opts: {
        quantity: string;
        grantDate: string;
        date?: string;
        stdin?: boolean;
      },
    ) => {
      asof(parts, opts);
    },
  );

/* ------------------------
 * Evaluate
 * ------------------------ */

/** Collect repeated --event NAME=YYYY-MM-DD into an array of { name, date }. */
function parseEvent(
  value: string,
  prev: Record<string, string> = {},
): Record<string, string> {
  const m = /^([^=]+)=(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!m) {
    throw new InvalidArgumentError(
      "Invalid --event. Use NAME=YYYY-MM-DD (e.g., --event milestone=2025-01-01)",
    );
  }
  const [, name, date] = m;
  return { ...prev, [name]: date };
}

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
      evaluate(parts, opts);
    },
  );
program.parseAsync();
