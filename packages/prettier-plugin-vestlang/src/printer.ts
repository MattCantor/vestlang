import type { Printer } from "prettier";
import type { Doc } from "prettier";
import type { AstNode } from "./types";
import type {
  ASTStatement,
  ASTExpr,
  ASTSchedule,
  EarlierOfASTExpr,
  LaterOfASTExpr,
  Duration,
  ConstrainedAnchor,
  From,
  DateAnchor,
  EventAnchor,
  Cliff,
  BaseConstraint,
  Constraint,
} from "@vestlang/dsl";
import { doc as PrettierDoc } from "prettier";

const { group, indent, line, softline, hardline, join, breakParent } =
  PrettierDoc.builders;

// ====== Formatting prefs ======
const UNITS_UPPERCASE = false; // set true for MONTH(S)/DAY(S) in caps

/* ---------- Leaf printers ---------- */

function printAmount(stmt: ASTStatement): Doc {
  const a = stmt.amount;
  if (!a) return "";
  if (a.type === "AmountAbsolute") return String(a.value) + " ";
  if (a.type === "AmountPercent") {
    const pct = (a.value * 100).toFixed(3).replace(/\.?0+$/, "");
    return pct === "100" ? "" : pct + " ";
  }
  return "";
}

function printAnchor(a: DateAnchor | EventAnchor | undefined | null): Doc {
  if (!a) return "";
  if (a.type === "Date") return group(["DATE ", a.value]);
  if (a.type === "Event") return group(["EVENT ", a.value]);
  return "";
}

function printBaseConstraint(p: BaseConstraint): Doc {
  // Keep spacing consistent: "<STRICTLY?> <AFTER/BEFORE> <anchor>"
  const pieces: Doc[] = [];
  if (p.strict) pieces.push("STRICTLY", " ");
  if (p.type === "After") {
    pieces.push("AFTER", " ", printAnchor(p.anchor));
  } else if (p.type === "Before") {
    pieces.push("BEFORE", " ", printAnchor(p.anchor));
  }
  return group(pieces);
}

function printConstraintEntry(c: Constraint): Doc {
  // OR-group: ( AFTER A OR AFTER B ... )
  if ("anyOf" in c) {
    const parts = c.anyOf.map(printBaseConstraint);
    return group([
      " ",
      "(",
      indent(
        group([
          softline,
          // sep must be a Doc — not an array/concat — so do:
          join(group([" OR", line]), parts),
        ]),
      ),
      softline,
      ")",
    ]);
  }
  // Atomic base constraint
  return group([" ", printBaseConstraint(c)]);
}

function printConstrained(q: ConstrainedAnchor): Doc {
  const entries = q.constraints?.map(printConstraintEntry) ?? [];
  return group([printAnchor(q.base), ...entries]);
}

function printFromComb(name: "EARLIER OF" | "LATER OF", items: From[]): Doc {
  return group([
    name,
    " (",
    indent(
      group([
        softline,
        // Use a Doc as the separator: ",\n"
        join(group([",", line]), items.map(printFromTerm)),
      ]),
    ),
    softline,
    ")",
  ]);
}

function printFromTerm(f: From): Doc {
  switch (f.type) {
    case "Date":
    case "Event":
      return printAnchor(f);
    case "Constrained":
      return printConstrained(f);
    case "EarlierOf":
      return printFromComb("EARLIER OF", f.items);
    case "LaterOf":
      return printFromComb("LATER OF", f.items);
    default:
      return "";
  }
}

function normalizeUnit(u: string): "MONTHS" | "DAYS" {
  const up = u.toUpperCase();
  return up === "MONTH" || up === "MONTHS" ? "MONTHS" : "DAYS";
}

function printDuration(d: Duration): Doc {
  const base = normalizeUnit(d.unit); // normalize for comparisons
  const singular = base === "MONTHS" ? "month" : "day";
  let unit = d.value === 1 ? singular : base.toLowerCase(); // "months"/"days"
  if (UNITS_UPPERCASE) unit = unit.toUpperCase();
  return `${d.value} ${unit}`;
}

/* ---------- Expr printers ---------- */

function printCliffComb(name: "EARLIER OF" | "LATER OF", items: Cliff[]): Doc {
  return group([
    name,
    " (",
    indent(group([softline, join(group([",", line]), items.map(printCliff))])),
    softline,
    ")",
  ]);
}

function printCliff(c: Cliff): Doc {
  if (!c) return "";
  if (c.type === "Duration") return printDuration(c);
  if (c.type === "Date" || c.type === "Event") return printAnchor(c);
  if (c.type === "Constrained") return printConstrained(c);
  if (c.type === "EarlierOf" || c.type === "LaterOf") {
    return printCliffComb(
      c.type === "EarlierOf" ? "EARLIER OF" : "LATER OF",
      c.items,
    );
  }
  return "";
}

function printSchedule(n: ASTSchedule): Doc {
  const fromDoc = n.from ? printFromTerm(n.from) : ("EVENT grant" as Doc); // default

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

  const cliffDoc = n.cliff ? printCliff(n.cliff) : "";
  if (cliffDoc) {
    parts.push(hardline, "CLIFF ", cliffDoc);
  }

  return group([breakParent, "SCHEDULE", indent(parts)]);
}

function printExprComb(name: "EARLIER OF" | "LATER OF", items: ASTExpr[]): Doc {
  return group([
    name,
    " (",
    indent(group([softline, join(group([",", line]), items.map(printExpr))])),
    softline,
    ")",
  ]);
}

function printExpr(e: ASTExpr): Doc {
  switch (e.type) {
    case "Schedule":
      return printSchedule(e);
    case "EarlierOf":
      return printExprComb("EARLIER OF", e.items);
    case "LaterOf":
      return printExprComb("LATER OF", e.items);
    default:
      return "";
  }
}

/* ---------- Root printer ---------- */

const docPrint = (node: AstNode): Doc => {
  if (!node) return "";

  switch (node.type) {
    case "Program":
      return group([
        join(
          hardline,
          (node.body as ASTStatement[]).map((s) =>
            group([printAmount(s), "VEST ", printExpr(s.expr)]),
          ),
        ),
        hardline,
      ]);

    case "Schedule":
      return printSchedule(node as ASTSchedule);
    case "EarlierOf":
      return printExprComb("EARLIER OF", (node as EarlierOfASTExpr).items);
    case "LaterOf":
      return printExprComb("LATER OF", (node as LaterOfASTExpr).items);

    default:
      return "";
  }
};

export const printer: Printer<AstNode> = {
  print(path): Doc {
    // Prefer `path.node` in Prettier v3+
    const node = path.node as AstNode;
    return docPrint(node);
  },
};
