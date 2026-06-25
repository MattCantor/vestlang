import {
  ResolutionContextInput,
  Program,
  Statement,
  EvaluatedSchedule,
} from "@vestlang/types";
import {
  resolveToCore,
  resolveInterchange,
  assertProgramInstallmentCap,
} from "./resolve/index.js";
import type { StatementContribution } from "./resolve/types.js";
import { assertEvaluableProgram } from "./guard.js";
import { assemble } from "./assemble.js";

/**
 * Evaluate one normalized Statement. We work it out two ways: `resolveToCore`
 * gives the closed-world result against the events we know, and `resolveInterchange`
 * gives the firing-invariant "what's storable" verdict. assemble pairs them into
 * one EvaluatedSchedule.
 */
export function evaluateStatement(
  stmt: Statement,
  ctx_input: ResolutionContextInput,
): EvaluatedSchedule {
  // The one structural / circular-gate guard for this path: resolveToCore enforces
  // only the installment cap now, so the hand-built program is vetted here, once,
  // before either assemble arm reads it (resolveInterchange carries no guard of its
  // own, so this can't lean on argument-evaluation order).
  assertEvaluableProgram([stmt]);
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
 * The THEN-chain grouping as a `statementOrder → groupIndex` map: the group index
 * for each statement in program order. Derived from `chainGroups` so the two can't
 * drift — exposed so the pipeline can group the per-statement partition into the
 * per-clause breakdown by the SAME chain logic the blocker pass uses, rather than
 * re-deriving it.
 */
export function chainGroupIndices(program: Program): number[] {
  return chainGroups(program).flatMap((group, i) => group.map(() => i));
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
  ctx_input: ResolutionContextInput,
): EvaluatedSchedule[] {
  assertEvaluableProgram(program);
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
 * (single cumulative round-down across the ordered template).
 */
export function evaluateProgram(
  stmts: Program,
  ctx_input: ResolutionContextInput,
): EvaluatedSchedule {
  // Vet the (possibly hand-built) program once at the entry — resolveToCore caps
  // but no longer repeats this structural / circular-gate guard (see
  // evaluateStatement).
  assertEvaluableProgram(stmts);
  return assemble(
    resolveToCore(stmts, ctx_input),
    resolveInterchange(stmts, ctx_input),
  );
}

/**
 * Evaluate a whole program AND return its per-statement partition of the headline
 * allocation — the breakdown amounts the pipeline attributes per clause. The
 * `schedule` is byte-for-byte `evaluateProgram`'s (so every existing consumer is
 * untouched); `contributions` rides alongside, off the resolver's result. The
 * recovery pass calls this on the ORIGINAL author program, so the partition always
 * attributes to the author's clauses even after a rescue.
 */
export function evaluateProgramWithContributions(
  stmts: Program,
  ctx_input: ResolutionContextInput,
): { schedule: EvaluatedSchedule; contributions: StatementContribution[] } {
  assertEvaluableProgram(stmts);
  const resolution = resolveToCore(stmts, ctx_input);
  return {
    schedule: assemble(resolution, resolveInterchange(stmts, ctx_input)),
    contributions: resolution.contributions,
  };
}
