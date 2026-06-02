import type { Program, Statement, VestingNodeExpr } from "@vestlang/types";
import { group, type Doc } from "./doc.js";
import { printFlat } from "./flat.js";
import { toDoc, toDocVestingNodeExpr } from "./to-doc.js";

/** The canonical string is the flat (infinite-width) print of the Doc. */
function flat(doc: Doc): string {
  return printFlat(group(doc));
}

/** Stringify a normalized AST node (Statement or Program). */
export function stringify(node: Statement | Program): string {
  return flat(toDoc(node));
}

export function stringifyStatement(s: Statement): string {
  return flat(toDoc(s));
}

export function stringifyProgram(p: Program): string {
  return flat(toDoc(p));
}

/** Flat print of a single vesting-node expression (used for diagnostics). */
export function stringifyVestingNodeExpr(node: VestingNodeExpr): string {
  return flat(toDocVestingNodeExpr(node));
}
