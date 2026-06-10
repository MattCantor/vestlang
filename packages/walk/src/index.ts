// @vestlang/walk
//
// One place that knows the *shape* of the DSL AST — specifically, for any node,
// which of its fields are themselves nodes worth recursing into. Packages that
// walk the tree (the linter, recovery, …) otherwise each spell that out for
// themselves, and hand-written copies tend to drift — it's easy to recurse over
// every node *kind* and still forget to follow one of its child fields, since
// nothing forces you to. Collecting the "what are this node's children?" answer
// in a single function means there's exactly one list to get right, and adding a
// new node kind turns into a compile error here rather than a silent gap.
//
// This operates on the *normalized* AST only. Straight off the parser a vesting
// start can be null and a cliff can be a bare Duration; the normalizer rewrites
// both into proper nodes first. Only the normalizer needs to know about that
// raw shape, so this traversal doesn't.

import { assertNever } from "@vestlang/utils";
import type {
  ChainedSchedule,
  Condition,
  Constraint,
  ScheduleExpr,
  Statement,
  VestingBase,
  VestingNodeExpr,
} from "@vestlang/types";

// Every node kind the traversal can land on, as one union. `ChainedSchedule` is
// listed alongside `ScheduleExpr` on purpose: a THEN-tail's `expr` has a null
// vesting start, which makes it *not* a plain `Schedule`, so the `ScheduleExpr`
// union doesn't already cover it. It still carries `type: "SCHEDULE"`, so the
// switch below handles it without a separate case.
//
// Note `Program` is deliberately absent — it's a bare `Statement[]` with no
// `type` tag, so it isn't a node. Walk it by iterating and entering at each
// statement (see the `some` example, and how recover/linter call in).
export type AstNode =
  | Statement
  | ScheduleExpr
  | ChainedSchedule
  | VestingNodeExpr
  | Condition
  | Constraint
  | VestingBase;

// How we got from a parent to a child: a field name for object fields
// ("base", "condition", …) or an array index for the arms of a selector / AND / OR.
export type Step = string | number;

// The trail of steps from the root down to the node currently being visited.
export type Path = Step[];

// The `default` of the child-dispatch switch below calls `assertNever` (from
// `@vestlang/utils`): because its parameter is typed `never`, the switch only
// compiles while every variant of `AstNode` is accounted for — add a node kind
// and forget to list its children and the build breaks right there.

// Hand each direct child of `node` to `visit`, along with the step that reaches
// it. This is the single source of truth for the AST's edges — everything else
// in this package, and every consumer, is built on top of it.
export function forEachChild(
  node: AstNode,
  visit: (child: AstNode, step: Step) => void,
): void {
  switch (node.type) {
    case "STATEMENT":
      visit(node.expr, "expr");
      return;

    case "SCHEDULE":
      // A chained tail has no start of its own (null), so guard before visiting.
      if (node.vesting_start) visit(node.vesting_start, "vesting_start");
      if (node.periodicity.cliff) visit(node.periodicity.cliff, "cliff");
      return;

    case "NODE":
      visit(node.base, "base");
      if (node.condition) visit(node.condition, "condition");
      return;

    case "ATOM":
      visit(node.constraint, "constraint");
      return;

    case "BEFORE":
    case "AFTER":
      // The reference anchor of a BEFORE/AFTER gate. Easy edge to overlook,
      // since the anchor is nested rather than a top-level field — an EVENT or
      // DATE gating a node lives down here.
      visit(node.base, "base");
      return;

    case "SCHEDULE_LATER_OF":
    case "SCHEDULE_EARLIER_OF":
    case "NODE_LATER_OF":
    case "NODE_EARLIER_OF":
    case "AND":
    case "OR":
      node.items.forEach((item, i) => visit(item, i));
      return;

    case "DATE":
    case "EVENT":
    case "GRANT_DATE":
    case "VESTING_START":
      return; // base leaves — nothing to descend into

    default:
      return assertNever(node);
  }
}

// Visit `node` and then everything beneath it, depth-first, parents before
// children. Each callback gets the path that reaches the node it's handed.
export function walk(
  node: AstNode,
  enter: (n: AstNode, path: Path) => void,
  path: Path = [],
): void {
  enter(node, path);
  forEachChild(node, (child, step) => walk(child, enter, [...path, step]));
}

// True if `node` or any node beneath it satisfies `pred`. Short of a real
// early-exit it still walks the whole subtree, which is fine for our trees.
export function some(node: AstNode, pred: (n: AstNode) => boolean): boolean {
  if (pred(node)) return true;
  let hit = false;
  forEachChild(node, (child) => {
    hit ||= some(child, pred);
  });
  return hit;
}

// True if `node` or anything beneath it is a named EVENT anchor. System anchors
// (GRANT_DATE / VESTING_START) are their own node kinds, not "EVENT", so they
// never trip this. An EVENT can hide in a base, a cliff, a selector arm, or the
// reference node of a BEFORE/AFTER gate — `some` descends every edge, so all count.
export function referencesEvent(node: AstNode): boolean {
  return some(node, (n) => n.type === "EVENT");
}

// The named-event id when `expr` is a bare event-anchored node (`FROM EVENT x`,
// `CLIFF EVENT x`), else undefined. A leaf-only read of the node's own base — it
// does not descend, so a combinator or a gate reference doesn't count. Typed at
// the widest anchor: DATE/EVENT bases are anchor-agnostic, so a node from any slot
// (a GRANT_DATE start, a VESTING_START cliff) is accepted.
export function eventBaseId(expr: VestingNodeExpr): string | undefined {
  return expr.type === "NODE" && expr.base.type === "EVENT"
    ? expr.base.value
    : undefined;
}
