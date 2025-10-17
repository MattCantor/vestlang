import {
  Amount,
  AmountPortion,
  Condition,
  Constraint,
  Duration,
  Offsets,
  Program,
  Schedule,
  ScheduleExpr,
  Statement,
  VestingBase,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import type { Printer, AstPath, Doc } from "prettier";
import {
  group,
  indent,
  softline,
  line,
  hardline,
  join,
  wrapParen,
  listWithCommas,
  kw,
} from "./builders.js";

function printAmount(a: Amount): Doc {
  if (a.type === "QUANTITY") return String(a.value);
  const p = a as AmountPortion;
  return `${p.numerator}/${p.denominator}`;
}

function printDuration(d: Duration): Doc {
  const sign = d.sign === "MINUS" ? "-" : "+";
  const unit = d.unit === "DAYS" ? "DAYS" : "MONTHS";
  return `${sign}${d.value} ${unit}`;
}

function printVestingBase(base: VestingBase): Doc {
  if (base.type === "EVENT") return [kw("EVENT"), " ", base.value];
  return [kw("DATE"), " ", base.value];
}

function printOffsets(offsets: Offsets): Doc {
  if (!offsets || offsets.length === 0) return "";
  return [" ", join(" ", offsets.map(printDuration))];
}

function printConstraint(c: Constraint): Doc {
  const strict = c.strict ? [kw("STRICTLY"), " "] : "";
  return [strict, kw(c.type), " ", printVestingNode(c.base)];
}

function printCondition(node?: Condition): Doc {
  if (!node) return "";
  switch (node.type) {
    case "ATOM":
      return printConstraint(node.constraint);
    case "AND":
    case "OR":
      const name = kw(node.type);
      const items = node.items.map(printCondition);
      return [name, " ", wrapParen(indent([listWithCommas(items)]))];
  }
}

function printVestingNode(node: VestingNodeExpr): Doc {
  switch (node.type) {
    case "EARLIER_OF":
    case "LATER_OF":
      const head = kw(node.type.replace("_", " "));
      const items = node.items.map((item) => printVestingNode(item));
      return [head, " ", wrapParen(indent([listWithCommas(items)]))];
    case "CONSTRAINED":
      return [
        [printVestingBase(node.base), printOffsets(node.offsets)],
        line,
        printCondition(node.constraints),
      ];
    case "BARE":
      return [printVestingBase(node.base), printOffsets(node.offsets)];
  }
}

function printPeriodicity(p: VestingPeriod): Doc {
  const base = [
    kw("OVER"),
    " ",
    printDuration({
      type: "DURATION",
      value: p.length * p.occurrences,
      unit: p.type,
      sign: "PLUS",
    }),
    printDuration({
      type: "DURATION",
      value: p.length,
      unit: p.type,
      sign: "PLUS",
    }),
  ];
  return base;
}

function printSchedule(s: Schedule): Doc {
  const parts: Doc[] = [];
  parts.push(printPeriodicity(s.periodicity));
  parts.push(" ", kw("FROM"), " ", printVestingNode(s.vesting_start));
  if (s.periodicity.cliff) {
    parts.push(line, kw("ClIFF"), " ", printVestingNode(s.periodicity.cliff));
  }
  return group(parts);
}

function printScheduleExpr(e: ScheduleExpr): Doc {
  switch (e.type) {
    case "SINGLETON":
      return printSchedule(e);
    case "LATER_OF":
    case "EARLIER_OF":
      return printScheduleExpr(e);
  }
}

function printStatement(s: Statement): Doc {
  const amount = [printAmount(s.amount), " "];
  return group([amount, kw("VEST"), " ", printScheduleExpr(s.expr)]);
}

const printer: Printer = {
  print(path: AstPath): Doc {
    const node = path.getValue() as Program | Statement | ScheduleExpr | any;

    if (Array.isArray(node)) {
      if (node.length === 1) return [printStatement(node[0]), hardline];
      const docs = node.map((s) => printStatement(s));
      return group([
        "[",
        indent([softline, join([",", hardline], docs)]),
        ",",
        softline,
        "]",
        hardline,
      ]);
    }

    return "";
  },
};

export default printer;
