import { Command } from "commander";
import { parse } from "@vestlang/dsl";
import { toCNF } from "@vestlang/normalizer";
import { evaluate } from "@vestlang/engine";
import { lint } from "@vestlang/linter";

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

program
  .command("cnf")
  .argument("<input...>")
  .action((parts: string[]) => {
    const input = parts.join(" ");
    const ast = parse(input);
    console.log(JSON.stringify(toCNF(ast), null, 2));
  });

program
  .command("eval")
  .option("--grant <iso>", "grant date ISO", "2025-01-01")
  .option("--cic <iso>", "change-in-control date ISO")
  .argument("<input...>")
  .action((parts: string[], opts) => {
    const input = parts.join(" ");
    const ast = parse(input);
    const events: Record<string, Date> = {
      grantDate: new Date(opts.grant + "T00:00:00Z"),
    };
    if (opts.cic) events["ChangeInControl"] = new Date(opts.cic + "T00:00:00Z");
    const out = evaluate(ast, { events });
    console.log(
      out.map((p) => ({
        at: p.at.toISOString(),
        vestedPercent: p.vestedPercent,
      })),
    );
  });

program
  .command("lint")
  .argument("<input...>")
  .action((parts: string[]) => {
    const input = parts.join(" ");
    const ast = parse(input);
    const issues = lint(ast);
    console.log(issues);
  });

program.parseAsync();
