// src/printer.ts
import type { Printer } from "prettier";
import type { Doc, AstNode } from "./types";
import type {
  Statement as VestStatement,
  Expr,
  Schedule,
  EarlierOfSchedules,
  LaterOfSchedules,
  Duration,
  ZeroGate,
  QualifiedAnchor,
  FromTerm,
  DateGate,
  EventAtom,
  TemporalPredNode,
  CliffTerm,
} from "@vestlang/dsl";
import { doc as PrettierDoc } from "prettier"
const { group, indent, line, softline, hardline, join, breakParent } = PrettierDoc.builders;

const lit = (s: string): Doc => s;

// ====== Formatting prefs ======
const UNITS_UPPERCASE = false; // set true for MONTH(S) / DAY(S) in caps

/* ---------- Leaf printers ---------- */

function printAmount(stmt: VestStatement): Doc {
  const a = stmt.amount;
  if (!a) return "";
  if (a.type === "AmountInteger") return String(a.value) + " ";
  if (a.type === "AmountPercent") {
    const pct = (a.value * 100).toFixed(3).replace(/\.?0+$/, "");
    // 100% should be implied by omitting amount, so we return "" when pct === "100"
    return pct === "100" ? "" : pct + " ";
  }
  return "";
}

function printAnchor(a: DateGate | EventAtom): Doc {
  if (a.type === "Date") return `DATE ${a.iso}`;
  if (a.type === "Event") return `EVENT ${a.name}`;
  return "";
}

function printPred(p: TemporalPredNode): Doc {
  switch (p.type) {
    case "After":
      return group([" AFTER ", printAnchor(p.i)]);
    case "Before":
      return group([" BEFORE ", printAnchor(p.i)]);
    case "Between":
      return group([" BETWEEN ", printAnchor(p.a), " AND ", printAnchor(p.b)]);
    default:
      return "";
  }
}

function printQualified(q: QualifiedAnchor): Doc {
  const preds = q.predicates?.map(printPred) ?? [];
  return group([printAnchor(q.base), ...preds]);
}

function printFromTerm(f: FromTerm): Doc {
  switch (f.type) {
    case "Date":
    case "Event":
      return printAnchor(f);
    case "Qualified":
      return printQualified(f);
    case "EarlierOf":
      return printFromComb("EARLIER OF", f.items);
    case "LaterOf":
      return printFromComb("LATER OF", f.items);
    default:
      return "";
  }
}

function printFromComb(
  name: "EARLIER OF" | "LATER OF",
  items: FromTerm[],
): Doc {
  return group([
    name,
    " (",
    indent(group([softline, join(["," + line], items.map(printFromTerm))])),
    softline,
    ")",
  ]);
}

function printDuration(d: Duration | ZeroGate): Doc {
  if (d.type === "Zero") return "0";
  // Normalize pluralization
  const base = d.unit; // "months" | "days"
  const singular = base === "months" ? "month" : "day";
  let unit = d.value === 1 ? singular : base;
  if (UNITS_UPPERCASE) unit = unit.toUpperCase();
  return `${d.value} ${unit}`;
}

/* ---------- Expr printers ---------- */

function printSchedule(n: Schedule): Doc {
  // Force structured, multi-line layout using hardline + breakParent
  const fromDoc = n.from ? printFromTerm(n.from) : ("EVENT grant" as Doc); // conventional default

  const parts: Doc[] = [
    hardline,
    "FROM ",
    fromDoc,
    hardline,
    "OVER ",
    printDuration(n.over),
    hardline,
    "EVERY ",
    printDuration(n.every),
  ];

  // Only print CLIFF if non-empty and meaningful (no Zero)
  const cliffDoc = n.cliff ? printCliff(n.cliff) : "";
  if (cliffDoc) {
    parts.push(hardline, "CLIFF ", cliffDoc);
  }

  // breakParent guarantees we don't collapse to a single line
  return group([breakParent, "SCHEDULE", indent(parts)]);
}

function printCliff(c: CliffTerm): Doc {
  if (!c) return "";
  if (c.type === "Zero") return ""; // suppress "CLIFF 0"
  if (c.type === "Duration") return printDuration(c);
  if (c.type === "Date" || c.type === "Event") return printAnchor(c);
  if (c.type === "Qualified") return printQualified(c);
  if (c.type === "EarlierOf" || c.type === "LaterOf") {
    return printCliffComb(
      c.type === "EarlierOf" ? "EARLIER OF" : "LATER OF",
      c.items,
    );
  }
  return "";
}

function printCliffComb(
  name: "EARLIER OF" | "LATER OF",
  items: CliffTerm[],
): Doc {
  // Map each child through printCliff
  return group([
    name,
    " (",
    indent(group([softline, join(["," + line], items.map(printCliff))])),
    softline,
    ")",
  ]);
}

function printExpr(e: Expr): Doc {
  switch (e.type) {
    case "Schedule":
      return printSchedule(e);
    case "EarlierOfSchedules":
      return printExprComb("EARLIER OF", e.items);
    case "LaterOfSchedules":
      return printExprComb("LATER OF", e.items);
    default:
      return "";
  }
}

function printExprComb(name: "EARLIER OF" | "LATER OF", items: Expr[]): Doc {
  return group([
    name,
    " (",
    indent(group([softline, join(["," + line], items.map(printExpr))])),
    softline,
    ")",
  ]);
}

/* ---------- Root printer ---------- */

const docPrint = (node: AstNode): Doc => {
  if (!node) return "";

  switch (node.type) {
    case "Program":
      // Join statements with hardlines, and ensure a trailing newline
      return group([
        join(
          hardline,
          (node.body as VestStatement[]).map((s) =>
            group([printAmount(s), "VEST ", printExpr(s.expr)]),
          ),
        ),
        hardline,
      ]);

    // If Prettier ever prints subnodes directly (shouldn’t for us):
    case "Schedule":
      return printSchedule(node as Schedule);
    case "EarlierOfSchedules":
      return printExprComb("EARLIER OF", (node as EarlierOfSchedules).items);
    case "LaterOfSchedules":
      return printExprComb("LATER OF", (node as LaterOfSchedules).items);

    default:
      return ""; // unreachable in normal flow
  }
};

export const printer: Printer = {
  print(path): Doc {
    const node = path.getValue() as AstNode;
    return docPrint(node);
  },
};
