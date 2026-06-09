import type {
  EvaluationContext,
  OCTDate,
  Offsets,
  ResolvedNode,
  UnresolvedNode,
  VestingNode,
} from "@vestlang/types";
import { assertNever } from "@vestlang/utils";
import { addDays, addMonthsRule } from "../time.js";

// Human label for the vesting-start anchor in a blocker. The anchor's identity is
// now a type tag, not a string; this is purely the word a diagnostic prints. It's
// exported so the absence-assumption collector can recognize and skip it — the
// vesting start is a system placeholder, not an event anyone witnesses.
export const VESTING_START_LABEL = "vestingStart";

export function evaluateVestingBase(
  node: VestingNode,
  ctx: EvaluationContext,
): ResolvedNode | UnresolvedNode {
  const base = node.base;
  switch (base.type) {
    // A literal calendar date is a known value, full stop. A date in the future
    // is no less *known* than one in the past — only its position relative to
    // "now" differs, and that's a question for projection, not resolution. So we
    // never gate it on asOf: whether the schedule has actually reached this date
    // yet is decided later, by comparing installment dates against asOf.
    case "DATE": {
      const date = applyOffsets(base.value, node.offsets, ctx);
      return { type: "RESOLVED", date };
    }
    // The grant date is always known (a required context field), so this anchor
    // resolves unconditionally — no as-of gate, matching how it resolved when it
    // lived in `events` keyed by "grantDate".
    case "GRANT_DATE":
      return {
        type: "RESOLVED",
        date: applyOffsets(ctx.grantDate, node.offsets, ctx),
      };
    // The vesting start is overlaid per-statement while resolving a cliff. If a
    // VESTING_START anchor is evaluated without that overlay, treat it as pending
    // rather than crashing or fabricating a date.
    case "VESTING_START":
      return ctx.vestingStart
        ? {
            type: "RESOLVED",
            date: applyOffsets(ctx.vestingStart, node.offsets, ctx),
          }
        : {
            type: "UNRESOLVED",
            blockers: [
              { type: "EVENT_NOT_YET_OCCURRED", event: VESTING_START_LABEL },
            ],
          };
    case "EVENT": {
      const eventDate = ctx.events[base.value];
      return eventDate
        ? { type: "RESOLVED", date: applyOffsets(eventDate, node.offsets, ctx) }
        : {
            type: "UNRESOLVED",
            blockers: [{ type: "EVENT_NOT_YET_OCCURRED", event: base.value }],
          };
    }
    default:
      return assertNever(base);
  }
}

function applyOffsets(
  base: OCTDate,
  offsets: Offsets,
  ctx: EvaluationContext,
): OCTDate {
  let d = base;
  for (const o of offsets) {
    d =
      o.unit === "MONTHS"
        ? addMonthsRule(d, o.sign === "PLUS" ? o.value : -o.value, ctx)
        : addDays(d, o.sign === "PLUS" ? o.value : -o.value);
  }
  return d;
}
