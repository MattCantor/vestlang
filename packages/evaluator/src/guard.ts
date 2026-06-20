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
//   2. The positional gate rule (#355): a *start*'s gate may not reference
//      VESTING_START — that is circular, the gate constraining the very start it
//      defines. The type model already forbids this at compile time; this is its
//      runtime analogue, for callers the compiler can't reach. The parser closes
//      the same door at parse time (#354) with a matching "circular dependency"
//      message.
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
  VestingNodeExpr,
} from "@vestlang/types";
import { collectAstErrors, collectNodeExprErrors } from "@vestlang/render";
import { some } from "@vestlang/walk";

const EVAL_PREFIX = "Cannot evaluate program:";

// Distinct from render's "Cannot stringify…" voice and from the installment-cap /
// kernel RangeError messages, so a caller (and a test) can tell the boundary
// guard's rejection apart from those. Mirrors createEvaluationContext's
// "Invalid evaluation context:" framing for the sibling context-date guard.
const formatStructuralError = (
  errors: { path: string; message: string }[],
): string =>
  `${EVAL_PREFIX} it is not a well-formed normalized vestlang program.\n${errors
    .map((e) => `  - ${e.path || "(root)"}: ${e.message}`)
    .join("\n")}`;

// True when `start` (a vesting-start subtree) carries a gate that references the
// VESTING_START anchor. A start node's own base is never VESTING_START — the
// positional invariant, already checked structurally above — so the only place a
// VESTING_START node can surface within a *start* subtree is as a BEFORE/AFTER
// gate reference, which is exactly the circular case. `some` descends every edge
// (the condition, its constraint, the reference base, and any nested gate on that
// base), so a vestingStart reference can't hide at depth or inside a selector arm.
const startGateRefsVestingStart = (start: VestingNodeExpr): boolean =>
  some(start, (n) => n.type === "VESTING_START");

// The shared tail of the circular-start-gate message, paralleling the parser's
// #354 wording. Both variants name the circular dependency and the fix.
const CIRCULAR_TAIL =
  "references vestingStart, which is circular — the gate would constrain the " +
  "very start it defines. Gate the start on a concrete date or a different event.";

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
      if (startGateRefsVestingStart(start)) {
        throw new Error(`${EVAL_PREFIX} statement[${i}]'s start gate ${CIRCULAR_TAIL}`);
      }
    }
  });
}

// The node-level variant, for resolveVestingStart — which takes a bare start node
// expression (not a Program) and never routes through the installment cap. Same
// two checks, scoped to the one node treated as a start anchor.
export function assertEvaluableNode(expr: VestingNodeExpr): void {
  const errors = collectNodeExprErrors(expr);
  if (errors.length > 0) throw new Error(formatStructuralError(errors));

  if (startGateRefsVestingStart(expr)) {
    throw new Error(`${EVAL_PREFIX} the start gate ${CIRCULAR_TAIL}`);
  }
}
