#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";

function readAllStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const program = new Command();

program.name("vest").description("Vestlang CLI").version("0.1.0");

// vest inspect [input...] [--stdin]
program
  .command("inspect")
  .argument("[input...]", "DSL text")
  .option("--stdin", "read input from stdin")
  .action((parts: string[] = [], opts: { stdin?: boolean }) => {
    const input = opts.stdin ? readAllStdin() : parts.join(" ");
    const ast = parse(input);
    console.log(JSON.stringify(ast, null, 2));
  });

// vest compile [input...] [--stdin]
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

program.parseAsync();
