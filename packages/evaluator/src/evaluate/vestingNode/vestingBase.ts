import type {
  EvaluationContext,
  OCTDate,
  Offsets,
  ResolvedNode,
  UnresolvedNode,
  VestingNode,
} from "@vestlang/types";
import { assertNever } from "@vestlang/utils";
import { addDays, addMonthsRule, gt } from "../time.js";

// Human label for the vesting-start anchor in a blocker. The anchor's identity is
// now a type tag, not a string; this is purely the word a diagnostic prints.
const VESTING_START_LABEL = "vestingStart";

export function evaluateVestingBase(
  node: VestingNode,
  ctx: EvaluationContext,
  asOf: boolean = true,
): ResolvedNode | UnresolvedNode {
  const base = node.base;
  switch (base.type) {
    case "DATE": {
      const date = applyOffsets(base.value, node.offsets, ctx);
      return asOf && gt(date, ctx.asOf)
        ? {
            type: "UNRESOLVED",
            blockers: [{ type: "DATE_NOT_YET_OCCURRED", date }],
          }
        : { type: "RESOLVED", date };
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
