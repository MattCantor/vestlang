import { Command } from "commander";
import { parse } from "@vestlang/dsl";
// import { toCNF } from "@vestlang/normalizer";
// import { lint } from "@vestlang/linter";

const program = new Command();

program.name("vest").description("Vesting DSL CLI").version("0.1.0");

program
  .command("parse")
  .argument("<input...>", "DSL text")
  .action((parts: string[]) => {
    const input = parts.join(" ");
    const ast = parse(input);
    console.log(JSON.stringify(ast, null, 2));
  });

// program
//   .command("cnf")
//   .argument("<input...>")
//   .action((parts: string[]) => {
//     const input = parts.join(" ");
//     const ast = parse(input);
//     console.log(JSON.stringify(toCNF(ast), null, 2));
//   });

// program
//   .command("lint")
//   .argument("<input...>")
//   .action((parts: string[]) => {
//     const input = parts.join(" ");
//     const ast = parse(input);
//     const issues = lint(ast);
//     console.log(issues);
//   });

program.parseAsync();
