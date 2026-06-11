import {
  EvaluationContextInput,
  Program,
  Statement,
  EvaluatedSchedule,
} from "@vestlang/types";
import {
  resolveToCore,
  resolveInterchange,
  assertProgramInstallmentCap,
} from "../resolve/index.js";
import { assemble } from "../resolve/assemble.js";

/**
 * Evaluate one normalized Statement. We work it out two ways: `resolveToCore`
 * gives the closed-world result against the events we know, and `resolveInterchange`
 * gives the firing-invariant "what's storable" verdict. assemble pairs them into
 * one EvaluatedSchedule.
 */
export function evaluateStatement(
  stmt: Statement,
  ctx_input: EvaluationContextInput,
): EvaluatedSchedule {
  return assemble(
    resolveToCore([stmt], ctx_input),
    resolveInterchange([stmt], ctx_input),
  );
}

/**
 * Split a program into THEN chains. A statement with no `chained` flag starts a
 * fresh chain (its own FROM anchors it); each `chained: true` tail joins the chain
 * already in progress. PLUS / independent statements each land in their own
 * single-element chain, so a program with no THEN comes back one statement per
 * group — unchanged from evaluating statement by statement.
 *
 * A tail can only ever follow a head or another tail (the grammar guarantees it),
 * so the first statement is never chained and every tail finds an open group.
 */
function chainGroups(program: Program): Statement[][] {
  const groups: Statement[][] = [];
  for (const stmt of program) {
    if (stmt.chained && groups.length > 0) {
      groups[groups.length - 1].push(stmt);
    } else {
      groups.push([stmt]);
    }
  }
  return groups;
}

/**
 * Evaluate a program one clause-group at a time: one EvaluatedSchedule per THEN
 * chain (a lone statement being a one-element chain), classified independently.
 * This is the entry per-clause consumers use — NOT a hand-rolled
 * `program.map(evaluateStatement)`, for two reasons. The installment cap spans the
 * whole program, so it has to be checked once over everything rather than per
 * group. And a THEN tail has no start of its own: handing `evaluateStatement` a
 * lone tail strands it with no preceding segment to continue from, so the chain
 * has to be resolved as a unit.
 */
export function evaluateClauseGroups(
  program: Program,
  ctx_input: EvaluationContextInput,
): EvaluatedSchedule[] {
  assertProgramInstallmentCap(program);
  return chainGroups(program).map((chain) =>
    assemble(
      resolveToCore(chain, ctx_input),
      resolveInterchange(chain, ctx_input),
    ),
  );
}

/**
 * Evaluate a whole program. The program collapses to ONE canonical schedule
 * (single cumulative round-down across the ordered template), returned as a
 * one-element array.
 */
export function evaluateProgram(
  stmts: Program,
  ctx_input: EvaluationContextInput,
): EvaluatedSchedule[] {
  return [
    assemble(
      resolveToCore(stmts, ctx_input),
      resolveInterchange(stmts, ctx_input),
    ),
  ];
}
