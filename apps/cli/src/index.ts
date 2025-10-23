#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import {
  expandAllocatedSchedule,
  evaluateStatementAsOf,
  EvaluationContext,
} from "@vestlang/evaluator";
import { OCTDate } from "@vestlang/types";

function readAllStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function getTodayISO(): OCTDate {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}` as OCTDate;
}

function validateDate(input: string): OCTDate {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  if (!dateRegex.test(input)) {
    console.error("Invalid date format. Use YYYY-MM-DD.");
    process.exit(1);
  }

  return input as OCTDate;
}

const program = new Command();

program.name("vest").description("Vestlang CLI").version("0.1.0");

// vestlang inspect [input...] [--stdin]
program
  .command("inspect")
  .argument("[input...]", "DSL text")
  .option("--stdin", "read input from stdin")
  .action((parts: string[] = [], opts: { stdin?: boolean }) => {
    const input = opts.stdin ? readAllStdin() : parts.join(" ");
    const ast = parse(input);
    console.log(JSON.stringify(ast, null, 2));
  });

// vestlang compile [input...] [--stdin]
program
  .command("compile")
  .argument("[input...]", "DSL text")
  .option("--stdin", "read input from stdin")
  .action((parts: string[] = [], opts: { stdin?: boolean }) => {
    const input = opts.stdin ? readAllStdin() : parts.join(" ");
    const ast = parse(input);
    const result = normalizeProgram(ast);
    console.log(JSON.stringify(result, null, 2));
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
      // quantity: must be a whole number
      const quantity = Number(opts.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) {
        console.error("Quantity must be a non-negative whole number.");
        process.exit(1);
      }

      const ctx: EvaluationContext = {
        events: { grantDate: validateDate(opts.grantDate) },
        grantQuantity: quantity,
        asOf: validateDate(opts.date ?? getTodayISO()),
        vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        allocation_type: "CUMULATIVE_ROUND_DOWN",
      };

      const input = opts.stdin ? readAllStdin() : parts.join(" ");
      const ast = parse(input);
      const normalized = normalizeProgram(ast);
      const results = normalized.map((s) => evaluateStatementAsOf(s, ctx));
      results.forEach((r) => {
        console.log("VESTED");
        console.table(r.vested);
        console.log("UNVESTED");
        console.table(r.unvested);
        console.log("UNRESOLVED");
        console.log(r.unresolved);
      });
      // console.log(JSON.stringify(results, null, 2));
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
      // quantity: must be a whole number
      const quantity = Number(opts.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) {
        console.error("Quantity must be a non-negative whole number.");
        process.exit(1);
      }

      const ctx: EvaluationContext = {
        events: { grantDate: validateDate(opts.grantDate) },
        grantQuantity: quantity,
        asOf: validateDate(getTodayISO()),
        vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        allocation_type: "CUMULATIVE_ROUND_DOWN",
      };

      const input = opts.stdin ? readAllStdin() : parts.join(" ");
      const ast = parse(input);
      const normalized = normalizeProgram(ast);
      const results = normalized.map((s) =>
        // buildScheduleWithBlockers(s.expr, ctx),
        expandAllocatedSchedule(s.expr, ctx),
      );
      results.forEach((r) => {
        console.log("VESTING START");
        console.table(r.vesting_start);
        if (r.cliff) {
          console.log("CLIFF");
          console.table(r.cliff);
        }
        console.log("TRANCHES");
        console.table(r.tranches);
        console.log("UNRESOLVED");
        console.log(r.unresolved);
      });

      // console.log(JSON.stringify(schedule, null, 2));
    },
  );

program.parseAsync();
