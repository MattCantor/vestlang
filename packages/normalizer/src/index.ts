import type { t } from "@vestlang/dsl";

export function toCNF(stmt: t.Statement): t.Statement {
  return {
    ...stmt,
    top: normTop(stmt.top),
  };
}

function normTop(node: t.TopStmt): t.TopStmt {
  switch (node.kind) {
    case "Program":
      return normProgram(node);
    case "EarlierOfPrograms":
      return {
        kind: "EarlierOfPrograms",
        items: flattenSame("EarlierOfPrograms", node.items.map(normTop)),
      };
    case "LaterOfPrograms":
      return {
        kind: "LaterOfPrograms",
        items: flattenSame("LaterOfPrograms", node.items.map(normTop)),
      };
  }
}

function normProgram(p: t.Program): t.Program {
  const schedule = p.schedule ?? oneShotSchedule(); // FROM grantdate, OVER 0, EVERY 0, Cliff Zero
  const ifc = p.if ? normCondition(p.if) : null;
  return {
    kind: "Program",
    schedule,
    if: ifc ?? undefined,
  };
}

function normCondition(c: t.Condition): t.Condition {
  switch (c.kind) {
    case "EarlierOf":
      return {
        kind: "EarlierOf",
        items: flattenSame("EarlierOf", c.items.map(normCondition)),
      };
    case "LaterOf":
      return {
        kind: "LaterOf",
        items: flattenSame("LaterOf", c.items.map(normCondition)),
      };
    default:
      return c;
  }
}

function oneShotSchedule(): t.Schedule {
  return {
    from: { kind: "Event", name: "grantDate" },
    over: { kind: "Duration", value: 0, unit: "days" },
    every: { kind: "Duration", value: 0, unit: "days" },
    cliff: { kind: "Zero" as const },
  };
}

function flattenSame(
  kind: "EarlierOfPrograms" | "LaterOfPrograms" | "EarlierOf" | "LaterOf",
  items: any[],
) {
  const out: any[] = [];
  for (const x of items) {
    if (x && x.kind === kind) out.push(...x.items);
    else out.push(x);
  }
  return out;
}
