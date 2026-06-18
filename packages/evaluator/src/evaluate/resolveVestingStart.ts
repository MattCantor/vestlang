// Resolve a bare anchor expression straight to its date — no allocation, no
// installments, no grant-date fold. This runs in `resolution` mode, so it reads
// real firings and lets a partial EARLIER_OF commit to its floor (the same
// closed-world reading evaluate uses, and what AC 11 relies on for resolve_offset).
//
// The result arms `evaluateVestingNodeExpr` can return collapse to two outcomes:
//   - PICKED + RESOLVED meta            → resolved, with the date
//   - PICKED + COMMITTED meta           → resolved, with the committed floor date
//   - PICKED + UNRESOLVED meta          → not resolved (a partial LATER OF)
//   - top-level UNRESOLVED / IMPOSSIBLE → not resolved (e.g. a contradictory gate)
// A resolved/committed pick yields its date via `pickedDate`; the rest gather their
// blockers and render a reason via blockerToString.

import type {
  Blocker,
  OCTDate,
  ResolutionContextInput,
  VestingNodeExpr,
} from "@vestlang/types";
import { createEvaluationContext } from "../utils.js";
import { evaluateVestingNodeExpr } from "./selectors.js";
import { pickedDate, type PickReturn } from "./utils.js";
import { blockerToString } from "./blockerToString.js";

export type ResolvedAnchor =
  | { resolved: true; date: OCTDate }
  | { resolved: false; blockers: Blocker[]; reason: string };

// Blockers of a non-resolved pick — same extraction rehydrate's blockersOf does:
// a PICKED-unresolved carries them on its meta, every other non-PICKED arm on the
// result itself. (A committed pick is resolved, so it never reaches here.)
const blockersOf = (res: PickReturn<unknown>): Blocker[] => {
  if (res.type === "PICKED") {
    return res.meta.type === "UNRESOLVED" ? res.meta.blockers : [];
  }
  return res.blockers;
};

export function resolveVestingStart(
  expr: VestingNodeExpr,
  ctxInput: ResolutionContextInput,
): ResolvedAnchor {
  const ctx = createEvaluationContext(ctxInput, "resolution");
  const res = evaluateVestingNodeExpr(expr, ctx);

  // A resolved OR committed pick both carry a concrete date — a partial EARLIER_OF
  // commits to its floor here (AC 11: resolve_offset over `EARLIER OF (DATE d,
  // EVENT e)` with e unfired now returns `d` instead of offset-unresolved).
  const date = pickedDate(res);
  if (date !== undefined) {
    return { resolved: true, date };
  }

  const blockers = blockersOf(res);
  return {
    resolved: false,
    blockers,
    reason: blockers.map(blockerToString).join(", "),
  };
}
