import {
  Amount,
  AmountPortion,
  RawSchedule,
  RawScheduleExpr,
  RawStatement,
  VestingNodeExpr,
  RawVestingPeriod,
  Duration,
} from "@vestlang/types";
import { Doc } from "prettier";
import { group, hardline, indent, kw, line } from "../builders.js";
import { printDuration, printVestingNode } from "./core.js";
import { printParenGroup } from "./utils.js";

/* ------------------------
 * API
 * ------------------------ */

export function printStatement(s: RawStatement): Doc {
  const amount = [printAmount(s.amount)];
  return group([amount, kw("VEST"), " ", printScheduleExpr(s.expr)]);
}

/* ------------------------
 * Internal
 * ------------------------ */

function printAmount(a: Amount): Doc {
  if (a.type === "QUANTITY") return `${String(a.value)} `;
  const p = a as AmountPortion;
  if (p.numerator === 1 && p.denominator === 1) return [];
  return `${p.numerator}/${p.denominator} `;
}

function printScheduleExpr(e: RawScheduleExpr): Doc {
  switch (e.type) {
    case "SINGLETON":
      return printSchedule(e);
    case "LATER_OF":
    case "EARLIER_OF":
      const keyword = kw(e.type.replace("_", " "));
      const items = e.items.map((item) => printScheduleExpr(item));
      return printParenGroup(keyword, items);
    // const head = kw(e.type.replace("_", " "));
    // const items = e.items.map((item) => printScheduleExpr(item));
    // return [head, " ", wrapParen(indent([listWithCommas(items)]))];
  }
}

function printSchedule(s: RawSchedule): Doc {
  const parts: Doc[] = [];
  if (s.vesting_start) {
    parts.push(kw("FROM"), " ", printVestingNodeExpr(s.vesting_start));
  }
  parts.push(printPeriodicity(s.periodicity));
  if (s.periodicity.cliff) {
    if (s.periodicity.cliff.type === "DURATION") {
      parts.push(
        indent([
          line,
          kw("CLIFF"),
          " ",
          `${s.periodicity.cliff.value} ${s.periodicity.cliff.unit.toLowerCase()}`,
        ]),
      );
    } else {
      parts.push(
        indent([
          line,
          kw("CLIFF"),
          " ",
          printVestingNodeExpr(s.periodicity.cliff),
        ]),
      );
    }
  }
  return group(parts);
}

function printPeriodicity(p: RawVestingPeriod): Doc {
  if (p.length === 0) return [];
  const base = indent([
    hardline,
    kw("OVER"),
    " ",
    `${p.length * p.occurrences} ${p.type.toLowerCase()}`,
    // printDuration({
    //   type: "DURATION",
    //   value: p.length * p.occurrences,
    //   unit: p.type,
    //   sign: "PLUS",
    // }),
    " ",
    kw("EVERY"),
    " ",
    `${p.length} ${p.type.toLowerCase()}`,
    // printDuration({
    //   type: "DURATION",
    //   value: p.length,
    //   unit: p.type,
    //   sign: "PLUS",
    // }),
  ]);
  return base;
}

function printVestingNodeExpr(node: Duration | VestingNodeExpr): Doc {
  switch (node.type) {
    case "DURATION":
      return printDuration(node);
    case "EARLIER_OF":
    case "LATER_OF":
      const keyword = kw(node.type.replace("_", " "));
      const items = node.items.map((item) => printVestingNodeExpr(item));
      return printParenGroup(keyword, items);
    // const head = kw(node.type.replace("_", " "));
    // const items = node.items.map((item) => printVestingNodeExpr(item));
    //
    // return [head, " (", indent([line, join([",", line], items)]), line, ")"];
    case "CONSTRAINED":
    case "BARE":
      return printVestingNode(node);
  }
}
