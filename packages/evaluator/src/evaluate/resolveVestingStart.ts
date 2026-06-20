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
  AbsenceAssumption,
  Blocker,
  OCTDate,
  ResolutionContextInput,
  VestingNodeExpr,
} from "@vestlang/types";
import { createEvaluationContext } from "../utils.js";
import { assertEvaluableNode } from "../guard.js";
import { evaluateVestingNodeExpr } from "./selectors.js";
import { isPickedCommitted, pickedDate, type PickReturn } from "./utils.js";
import { collectAbsences } from "./absences.js";
import { blockerToString } from "./blockerToString.js";

// The resolved arm ALWAYS carries `assumptions` — `[]` for a fully-resolved anchor,
// and the disclosed non-occurrences for a committed EARLIER_OF (which settled to its
// floor while some sibling event stayed unfired). Keeping the field uniform (rather
// than optional) means a read-site can't quietly skip the committed case, mirroring
// why `pickedDate` routes both RESOLVED and COMMITTED through one accessor.
export type ResolvedAnchor =
  | { resolved: true; date: OCTDate; assumptions: AbsenceAssumption[] }
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
  // This path takes a bare node (no Program, no installment cap), so it carries
  // its own structural + circular-start-gate guard (#335 / #355). The node is
  // treated as a start anchor, so a vestingStart gate reference on it is circular.
  assertEvaluableNode(expr);
  const ctx = createEvaluationContext(ctxInput, "resolution");
  const res = evaluateVestingNodeExpr(expr, ctx);

  // A resolved OR committed pick both carry a concrete date — a partial EARLIER_OF
  // commits to its floor here (AC 11: resolve_offset over `EARLIER OF (DATE d,
  // EVENT e)` with e unfired now returns `d` instead of offset-unresolved).
  const date = pickedDate(res);
  if (date !== undefined) {
    // A COMMITTED pick reached its floor while a sibling event stayed unfired —
    // its `meta.disclosures` are exactly the "assumes e absent through d" notes the
    // commit leans on. A plain RESOLVED pick has nothing to disclose, hence `[]`.
    // `pickedDate` alone can't see this: it returns the date off both arms and
    // erases the COMMITTED meta, so we read the disclosures off the committed pick
    // directly. (#325 — restores on this narrow path the disclosure `evaluate`
    // already surfaces.)
    const assumptions = isPickedCommitted(res)
      ? collectAbsences(res.meta.disclosures)
      : [];
    return { resolved: true, date, assumptions };
  }

  const blockers = blockersOf(res);
  return {
    resolved: false,
    blockers,
    reason: blockers.map(blockerToString).join(", "),
  };
}
