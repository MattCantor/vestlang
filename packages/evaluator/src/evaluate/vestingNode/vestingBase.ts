import type {
  Blocker,
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
// a type tag, not a string; this is purely the word a diagnostic prints. Module-
// local: callers recognize the placeholder through `isVestingStartPlaceholder`
// below, not by comparing this string themselves.
const VESTING_START_LABEL = "vestingStart";

// The pending-vesting-start blocker this module mints (above) is a system
// placeholder, not a real awaited event: it reads on the start, never on a cliff,
// and it's not a disclosable absence assumption. Recognizing it lives here, next
// to where it's constructed, so the two stay in step.
export const isVestingStartPlaceholder = (b: Blocker): boolean =>
  b.type === "EVENT_NOT_YET_OCCURRED" && b.event === VESTING_START_LABEL;

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
