import {
  ChainedSchedule,
  Condition,
  Program,
  ScheduleExpr,
  Statement,
  VestingNodeExpr,
} from "@vestlang/types";
import { NodePath, Visitor } from "./types.js";

export function walkProgram(p: Program, v: Visitor) {
  v.Program?.(p);
  p.forEach((stmt, i) => walkStatement(stmt, v, ["Program", i]));
}

function walkStatement(node: Statement, v: Visitor, path: NodePath) {
  v.Statement?.(node, path);
  walkScheduleExpr(node.expr, v, path.concat("expr"));
}

// Accepts a chained tail too: it's a start-less singleton, and the
// vesting_start guard below simply skips the absent start.
function walkScheduleExpr(
  e: ScheduleExpr | ChainedSchedule,
  v: Visitor,
  path: NodePath,
) {
  if (e.type === "SINGLETON") {
    const schedule = e;
    if (schedule.vesting_start)
      walkVestingNodeExpr(
        schedule.vesting_start,
        v,
        path.concat("vesting_start"),
      );
    const cliff = schedule.periodicity.cliff;
    if (cliff)
      walkVestingNodeExpr(cliff, v, path.concat("periodicity", "cliff"));
  } else {
    v.ScheduleSelector?.(e, path);
    e.items.forEach((item, i) =>
      walkScheduleExpr(item, v, path.concat("items", i)),
    );
  }
}

function walkVestingNodeExpr(e: VestingNodeExpr, v: Visitor, path: NodePath) {
  if (e.type === "SINGLETON") {
    const vestingNode = e;
    v.VestingNode?.(vestingNode, path);
    if (vestingNode.condition)
      walkCondition(vestingNode.condition, v, path.concat("condition"));
  } else {
    v.VestingNodeSelector?.(e, path);
    e.items.forEach((item, i) =>
      walkVestingNodeExpr(item, v, path.concat("items", i)),
    );
  }
}

function walkCondition(c: Condition, v: Visitor, path: NodePath) {
  v.Condition?.(c, path);
  switch (c.type) {
    case "ATOM":
      return;
    case "AND":
      v.AndCondition?.(c, path);
      c.items.forEach((item, i) =>
        walkCondition(item, v, path.concat("items", i)),
      );
      return;
    case "OR":
      v.OrCondition?.(c, path);
      c.items.forEach((item, i) =>
        walkCondition(item, v, path.concat("items", i)),
      );
      return;
  }
}
