import type { Program, Statement, VestingNodeExpr } from "@vestlang/types";
import { group, type Doc } from "./doc.js";
import { printFlat } from "./flat.js";
import { toDoc, toDocVestingNodeExpr } from "./to-doc.js";
import { assertPrintable } from "./validate.js";

/** The canonical string is the flat (infinite-width) print of the Doc. */
function flat(doc: Doc): string {
  return printFlat(group(doc));
}

// Each public entry point validates before it prints: a structurally-plausible
// node with bad values (negative cadence, a non-calendar DATE) would otherwise
// emit DSL that fails to re-parse. assertPrintable throws one readable error
// instead, and a malformed shape (bare `{}`, wrong type) is rejected here rather
// than crashing deep in the Doc traversal.

/** Stringify a normalized AST node (Statement or Program). */
export function stringify(node: Statement | Program): string {
  assertPrintable(node);
  return flat(toDoc(node));
}

export function stringifyStatement(s: Statement): string {
  assertPrintable(s);
  return flat(toDoc(s));
}

export function stringifyProgram(p: Program): string {
  assertPrintable(p);
  return flat(toDoc(p));
}

/** Flat print of a single vesting-node expression (used for diagnostics). */
export function stringifyVestingNodeExpr(node: VestingNodeExpr): string {
  return flat(toDocVestingNodeExpr(node));
}
