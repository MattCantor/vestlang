#!/usr/bin/env node
import { Command } from "commander";
import { inspect } from "./inspect.js";
import { compile } from "./compile.js";
import { asof } from "./asof.js";
import { expand } from "./expand.js";
import { build } from "./build.js";

const program = new Command();

program.name("vest").description("Vestlang CLI").version("0.1.0");

// vestlang inspect [input...] [--stdin]
program
  .command("inspect")
  .argument("[input...]", "DSL text")
  .option("--stdin", "read input from stdin")
  .action((parts: string[] = [], opts: { stdin?: boolean }) => {
    inspect(parts, opts);
  });

// vestlang compile [input...] [--stdin]
program
  .command("compile")
  .argument("[input...]", "DSL text")
  .option("--stdin", "read input from stdin")
  .action((parts: string[] = [], opts: { stdin?: boolean }) => {
    compile(parts, opts);
  });

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

program
  .command("expand")
  .description("Expand the vesting schedule")
  .requiredOption("-q, --quantity <number>", "total number of shares granted")
  .requiredOption("-g, --grantDate <string>", "grant date of the award")
  .option("--stdin", "read input from stdin")
  .argument("[input...]", "DSL text")
  .action(
    (
      parts: string[],
      opts: {
        quantity: string;
        grantDate: string;
        stdin?: boolean;
      },
    ) => {
      expand(parts, opts);
    },
  );

program
  .command("build")
  .description("Build the vesting schedule with metadata")
  .requiredOption("-q, --quantity <number>", "total number of shares granted")
  .requiredOption("-g, --grantDate <string>", "grant date of the award")
  .option("--stdin", "read input from stdin")
  .argument("[input...]", "DSL text")
  .action(
    (
      parts: string[],
      opts: {
        quantity: string;
        grantDate: string;
        stdin?: boolean;
      },
    ) => {
      build(parts, opts);
    },
  );
program.parseAsync();
