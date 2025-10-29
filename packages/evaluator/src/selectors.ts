import {
  EvaluationContext,
  ResolvedNode,
  Blocker,
  VestingNodeExpr,
  Schedule,
  UnresolvedNode,
  ImpossibleNode,
  ImpossibleBlocker,
  VestingNode,
  ScheduleExpr,
  EarlierOfSchedule,
  LaterOfSchedule,
  LaterOfVestingNode,
  EarlierOfVestingNode,
} from "@vestlang/types";
import { resolveNode } from "./resolveConditions.js";
import { lt } from "./time.js";

type Picked<T> = {
  type: "PICKED";
  picked: T;
  meta: ResolvedNode | UnresolvedNode;
};

type PickReturn<T> = Picked<T> | UnresolvedNode | ImpossibleNode;

export function pickFromScheduleExpr(
  expr: ScheduleExpr,
  ctx: EvaluationContext,
): PickReturn<Schedule> {
  let candidates: PickReturn<Schedule>[] | undefined = undefined;
  switch (expr.type) {
    case "EARLIER_OF":
      candidates = expr.items.map((item) => pickFromScheduleExpr(item, ctx));
      return handleEarlierOf(expr, candidates);
    case "LATER_OF":
      candidates = expr.items.map((item) => pickFromScheduleExpr(item, ctx));
      return handleLaterOf(expr, candidates);
    case "SINGLETON":
      const res = pickFromVestingNodeExpr(expr.vesting_start, ctx);
      switch (res.type) {
        case "PICKED":
          return {
            type: res.type,
            picked: expr as Schedule,
            meta: res.meta,
          } as Picked<Schedule>;
        case "UNRESOLVED":
        case "IMPOSSIBLE":
          return res;
      }
  }
}

export function pickFromVestingNodeExpr(
  expr: VestingNodeExpr,
  ctx: EvaluationContext,
): PickReturn<VestingNode> {
  let candidates: PickReturn<VestingNode>[] | undefined = undefined;
  switch (expr.type) {
    case "EARLIER_OF":
      candidates = expr.items.map((item) => pickFromVestingNodeExpr(item, ctx));
      return handleEarlierOf(expr, candidates);
    case "LATER_OF":
      candidates = expr.items.map((item) => pickFromVestingNodeExpr(item, ctx));
      return handleLaterOf(expr, candidates);
    case "BARE":
    case "CONSTRAINED":
      const res = resolveNode(expr, ctx);
      switch (res.type) {
        case "RESOLVED":
          return { type: "PICKED", picked: expr, meta: res };
        case "UNRESOLVED":
          return { type: "PICKED", picked: expr, meta: res };
        case "IMPOSSIBLE":
          return res;
      }
  }
}

function isResolved(x: any): x is {
  type: "PICKED";
  meta: ResolvedNode;
} {
  return (
    !!x &&
    typeof x === "object" &&
    x.type === "PICKED" &&
    x.meta.type === "RESOLVED"
  );
}

function handleEarlierOf<T extends Schedule | VestingNode>(
  expr: T extends Schedule ? EarlierOfSchedule : EarlierOfVestingNode,
  candidates: PickReturn<T>[],
): PickReturn<T> {
  let picked: T | undefined;
  let best: ResolvedNode | undefined = undefined;

  // Resolved only if at least one item is resolved
  if (candidates.some((r) => isResolved(r))) {
    for (const r of candidates) {
      if (isResolved(r)) {
        if (!best) {
          best = r.meta;
          picked = r.picked;
        } else {
          best = evaluateNode(best, r.meta, expr.type);
          if (best === r.meta) picked = r.picked;
        }
      }
    }
    if (best && picked)
      return {
        type: "PICKED",
        picked: picked,
        meta: best,
      };
    throw new Error(
      `evaluateScheduleExpr: unexpected unresolved expressions: ${candidates}`,
    );
  }

  // Impossible if all items are impossible
  if (candidates.every((r) => r.type === "IMPOSSIBLE")) {
    return {
      type: "IMPOSSIBLE",
      blockers: candidates.reduce((acc, r) => {
        acc.push(...r.blockers);
        return acc;
      }, [] as ImpossibleBlocker[]),
    };
  }

  // Otherwise unresolved
  return {
    type: "UNRESOLVED",
    blockers: candidates.reduce((acc, r) => {
      if (r.type === "PICKED") return acc;
      acc.push(...r.blockers);
      return acc;
    }, [] as Blocker[]),
  };
}

function handleLaterOf<T extends Schedule | VestingNode>(
  expr: T extends Schedule ? LaterOfSchedule : LaterOfVestingNode,
  candidates: PickReturn<T>[],
): PickReturn<T> {
  let picked: T | undefined = undefined;
  let best: ResolvedNode | undefined = undefined;

  console.log(" ");
  console.log("handleLaterOf - candidates:", JSON.stringify(candidates));

  // Resolved only if all items are resolved
  if (candidates.every((r) => isResolved(r))) {
    for (const r of candidates) {
      if (!best) {
        best = r.meta;
        picked = r.picked;
      } else {
        best = evaluateNode(best, r.meta, expr.type);
        if (best === r.meta) picked = r.picked;
      }
    }
    if (best && picked)
      return {
        type: "PICKED",
        picked: picked,
        meta: best,
      };
    throw new Error(
      `evaluateScheduleExpr: unexpected unresolved expressions: ${candidates}`,
    );
  }

  // Impossible if all items are impossible
  if (candidates.every((r) => r.type === "IMPOSSIBLE")) {
    return {
      type: "IMPOSSIBLE",
      blockers: candidates.reduce((acc, r) => {
        acc.push(...r.blockers);
        return acc;
      }, [] as ImpossibleBlocker[]),
    };
  }

  // Otherwise unresolved
  return {
    type: "UNRESOLVED",
    blockers: candidates.reduce((acc, r) => {
      if (r.type === "PICKED" && r.meta.type === "UNRESOLVED")
        acc.push(...r.meta.blockers);
      if (r.type === "IMPOSSIBLE") acc.push(...r.blockers);
      return acc;
    }, [] as Blocker[]),
  };
}

function evaluateNode(
  best: ResolvedNode,
  candidate: ResolvedNode,
  selectorType: "EARLIER_OF" | "LATER_OF",
) {
  const better =
    selectorType === "EARLIER_OF"
      ? lt(candidate.date, best.date)
      : lt(best.date, candidate.date);

  if (better) best = candidate;
  return best;
}
