// The evaluator's structural boundary guard. A program reaching the published
// evaluate surface may have been hand-built in JS, bypassing the front end
// (grammar / CLI / MCP-zod) that normally vets it — so before we resolve anything
// we re-check the two things the type system can't enforce on an untrusted value:
//
//   1. Structural / calendar well-formedness — via the SAME collector render's
//      stringifier uses (collectAstErrors), so a hand-built program with an
//      impossible DATE literal ("2025-02-31"), a negative cadence, or any other
//      malformed value fails loud here instead of silently rolling forward in the
//      date kernel (#335) or crashing deep in resolution. We voice our own
//      eval-flavored message over the shared error list rather than render's
//      "Cannot stringify…" one.
//
//   2. The positional vestingStart rules (#355 / #354): within a *start*,
//      vestingStart may sit in neither the anchor position (a reserved system
//      event can't anchor a start) nor a gate (circular — the gate would
//      constrain the very start it defines). The type model forbids both at
//      compile time; this is the runtime analogue for callers the compiler can't
//      reach, and it splits the two into distinct diagnostics the way the parser
//      does (#354) rather than reporting a misplaced anchor as a phantom gate.
//
// Order matters: the structural check runs FIRST. Only once it passes is the AST
// known to be on-union, which is what makes @vestlang/walk safe to use for the
// positional check — walk's forEachChild calls assertNever and throws on any
// off-union shape, so running it over an unvalidated hand-built program could
// throw an unhelpful internal error instead of our diagnostic.

import type {
  ChainedSchedule,
  Program,
  ScheduleExpr,
  Statement,
  VestingNode,
  VestingNodeExpr,
} from "@vestlang/types";
import {
  collectAstErrors,
  collectNodeExprErrors,
  formatAstErrors,
  type AstError,
} from "@vestlang/render";
import { some } from "@vestlang/walk";

const EVAL_PREFIX = "Cannot evaluate program:";

// Distinct from render's "Cannot stringify…" voice and from the installment-cap /
// kernel RangeError messages, so a caller (and a test) can tell the boundary
// guard's rejection apart from those. Mirrors createEvaluationContext's
// "Invalid evaluation context:" framing for the sibling context-date guard.
const formatStructuralError = (errors: AstError[]): string =>
  `${EVAL_PREFIX} it is not a well-formed normalized vestlang program.\n${formatAstErrors(
    errors,
  )}`;

// Visit each node on a start's anchor spine — the node itself, and each arm of a
// selector — WITHOUT descending into gates. A node's own `base` is an anchor
// position; its `condition` is gate territory, walked separately below.
function forEachAnchorNode(
  expr: VestingNodeExpr,
  visit: (node: VestingNode) => void,
): void {
  switch (expr.type) {
    case "NODE":
      visit(expr);
      return;
    case "NODE_EARLIER_OF":
    case "NODE_LATER_OF":
      for (const arm of expr.items) forEachAnchorNode(arm, visit);
      return;
  }
}

// The two distinct ways a start can illegally involve vestingStart, kept apart so
// each gets its own diagnostic the way the parser does (#354) — reporting a
// misplaced anchor as a circular gate would point the reader at the wrong fix:
//   "anchor" — vestingStart sits in the start's own anchor position. A reserved
//              system event can't anchor a start, and the structural collector
//              does NOT catch this (it accepts any system-anchor base regardless
//              of slot), so this guard is the one rejection a hand-built program
//              of this shape hits.
//   "gate"   — vestingStart appears inside the start's gate: circular, the gate
//              constraining the very start it defines. `some` over the condition
//              subtree finds it at any depth — a gate reference's own base, or a
//              further nested gate.
// Returns the first violation found (anchor takes precedence within a node, as in
// the parser, which checks the anchor position first), or null.
type StartViolation = "anchor" | "gate";

function startVestingStartViolation(
  start: VestingNodeExpr,
): StartViolation | null {
  let found: StartViolation | null = null;
  forEachAnchorNode(start, (node) => {
    if (found) return;
    if (node.base.type === "VESTING_START") {
      found = "anchor";
    } else if (
      node.condition &&
      some(node.condition, (n) => n.type === "VESTING_START")
    ) {
      found = "gate";
    }
  });
  return found;
}

// Throw the violation's message, localized to the offending start (`where` is
// "statement[2]'s start" on the Program path, "the start" for a bare node). Both
// parallel the parser's two #354 errors: the anchor message points at the
// misplaced reserved anchor, the gate message at the circular dependency.
function throwStartViolation(kind: StartViolation, where: string): never {
  if (kind === "anchor") {
    throw new Error(
      `${EVAL_PREFIX} ${where} anchors on vestingStart, a reserved system event ` +
        `that cannot anchor a start. Pick a different event name.`,
    );
  }
  throw new Error(
    `${EVAL_PREFIX} ${where} gate references vestingStart, which is circular — ` +
      `the gate would constrain the very start it defines. Gate the start on a ` +
      `concrete date or a different event.`,
  );
}

// Pull each schedule's own start node out of a statement's expression. A
// ScheduleExpr may be a selector over schedules, so a single statement can carry
// several starts (one per arm); a chained tail has a null start and contributes
// none. Only the start subtree is returned — the cliff lives elsewhere and a
// VESTING_START gate there is legal (#351), so it must not be swept in. (The
// expr is already known on-union here; the structural pass ran first.)
function startsOfExpr(
  expr: ScheduleExpr | ChainedSchedule,
  starts: VestingNodeExpr[],
): void {
  switch (expr.type) {
    case "SCHEDULE":
      if (expr.vesting_start) starts.push(expr.vesting_start);
      return;
    case "SCHEDULE_LATER_OF":
    case "SCHEDULE_EARLIER_OF":
      for (const arm of expr.items) startsOfExpr(arm, starts);
      return;
  }
}

function startsOfStatement(stmt: Statement): VestingNodeExpr[] {
  const starts: VestingNodeExpr[] = [];
  startsOfExpr(stmt.expr, starts);
  return starts;
}

// Run both checks over a hand-built program at the evaluator boundary. Co-located
// with assertProgramInstallmentCap on every public AST entry.
export function assertEvaluableProgram(program: Program): void {
  const errors = collectAstErrors(program);
  if (errors.length > 0) throw new Error(formatStructuralError(errors));

  // Structural pass cleared the AST as on-union, so walk is safe now.
  program.forEach((stmt, i) => {
    for (const start of startsOfStatement(stmt)) {
      const violation = startVestingStartViolation(start);
      if (violation) throwStartViolation(violation, `statement[${i}]'s start`);
    }
  });
}

// The node-level variant, for resolveVestingStart — which takes a bare start node
// expression (not a Program) and never routes through the installment cap. Same
// two checks, scoped to the one node treated as a start anchor.
export function assertEvaluableNode(expr: VestingNodeExpr): void {
  const errors = collectNodeExprErrors(expr);
  if (errors.length > 0) throw new Error(formatStructuralError(errors));

  const violation = startVestingStartViolation(expr);
  if (violation) throwStartViolation(violation, "the start");
}
