import type {
  Blocker,
  ResolutionContext,
  OCTDate,
  Offsets,
  ResolvedNode,
  UnresolvedNode,
  VestingNode,
} from "@vestlang/types";
import { assertNever } from "@vestlang/utils";
import { addDays } from "@vestlang/core";
import { addMonthsRule, addMonthsExact } from "../time.js";

// Human label for the vesting-start anchor in a blocker. The anchor's identity is
// a type tag, not a string; this is purely the word a diagnostic prints. Module-
// local: callers recognize the placeholder through `isVestingStartPlaceholder`
// below, not by comparing this string themselves.
const VESTING_START_LABEL = "vestingStart";

// The vesting-start system anchor a cliff hangs off. It's engine working state,
// overlaid onto the context per-statement while resolving a cliff (see
// resolve/cliff.ts), not a stored field — so it rides on an evaluator-local
// extension of the published context rather than on the published type itself.
// Optional because the base (un-overlaid) context has no start: a VESTING_START
// anchor evaluated without the overlay falls through to the pending arm below.
export type CliffEvaluationContext = ResolutionContext & {
  vestingStart?: OCTDate;
};

// The pending-vesting-start blocker this module mints (above) is a system
// placeholder, not a real awaited event: it reads on the start, never on a cliff,
// and it's not a disclosable absence assumption. Recognizing it lives here, next
// to where it's constructed, so the two stay in step.
export const isVestingStartPlaceholder = (b: Blocker): boolean =>
  b.type === "EVENT_NOT_YET_OCCURRED" && b.event === VESTING_START_LABEL;

// What this node is being resolved *as*. A node played as the schedule's own
// anchor (a start, or a cliff hanging off the vesting start) is a vesting date;
// played as a BEFORE/AFTER reference it's a comparison boundary. The distinction
// decides whether a MONTHS offset snaps to the day-of-month policy: only cadence
// snaps, and only an anchor can be cadence. A gate is always exact, even when it
// references the same `vestingStart` anchor a cliff would snap on (the #351
// construct) — so `base.type` alone can't make the call, and the caller threads
// its role in. See applyOffsets for the rule.
export type VestingBaseRole = "anchor" | "gate";

export function evaluateVestingBase(
  node: VestingNode,
  ctx: CliffEvaluationContext,
  role: VestingBaseRole,
): ResolvedNode | UnresolvedNode {
  const base = node.base;
  // A MONTHS offset snaps to the policy only when this node is the cadence
  // anchor *and* it hangs off the vesting start (the bare-duration cliff
  // `CLIFF N months`). Every other case — start anchors, date/event offsets, and
  // all gate boundaries regardless of anchor — steps an exact duration.
  const snap = role === "anchor" && base.type === "VESTING_START";
  switch (base.type) {
    // A literal calendar date is a known value, full stop. A date in the future
    // is no less *known* than one in the past — only its position relative to
    // "now" differs, and that's a question for projection, not resolution. So we
    // never gate it on asOf: whether the schedule has actually reached this date
    // yet is decided later, by comparing installment dates against asOf.
    case "DATE": {
      const date = applyOffsets(base.value, node.offsets, ctx, snap);
      return { type: "RESOLVED", date };
    }
    // The grant date is always known (a required context field), so this anchor
    // resolves unconditionally — no as-of gate, matching how it resolved when it
    // lived in `events` keyed by "grantDate".
    case "GRANT_DATE":
      return {
        type: "RESOLVED",
        date: applyOffsets(ctx.grantDate, node.offsets, ctx, snap),
      };
    // The vesting start is overlaid per-statement while resolving a cliff. If a
    // VESTING_START anchor is evaluated without that overlay, treat it as pending
    // rather than crashing or fabricating a date.
    case "VESTING_START":
      return ctx.vestingStart
        ? {
            type: "RESOLVED",
            date: applyOffsets(ctx.vestingStart, node.offsets, ctx, snap),
          }
        : {
            type: "UNRESOLVED",
            blockers: [
              { type: "EVENT_NOT_YET_OCCURRED", event: VESTING_START_LABEL },
            ],
          };
    case "EVENT": {
      // Read through `Object.hasOwn` so an id that collides with an
      // `Object.prototype` key (`constructor`, `toString`, …) can't read back the
      // inherited value off a plain events map. Keep the truthiness check after it:
      // a named-but-unfired event is present with value `undefined`, and that must
      // stay pending, not resolve to a `undefined` date.
      const eventDate = Object.hasOwn(ctx.events, base.value)
        ? ctx.events[base.value]
        : undefined;
      return eventDate
        ? {
            type: "RESOLVED",
            date: applyOffsets(eventDate, node.offsets, ctx, snap),
          }
        : {
            type: "UNRESOLVED",
            blockers: [{ type: "EVENT_NOT_YET_OCCURRED", event: base.value }],
          };
    }
    default:
      return assertNever(base);
  }
}

// Walk the node's offsets onto its base date. A DAYS offset is the same exact
// calendar step everywhere. A MONTHS offset diverges: `snap` true makes it
// cadence (consult the day-of-month policy on the context, so a fixed "15" pulls
// it to the 15th), `snap` false makes it an exact duration (keep the day, clamp
// to month-end on a shorter month, never read the policy). Only a cliff's own
// `vestingStart` anchor passes `snap` true — see `evaluateVestingBase`.
function applyOffsets(
  base: OCTDate,
  offsets: Offsets,
  ctx: ResolutionContext,
  snap: boolean,
): OCTDate {
  let d = base;
  for (const o of offsets) {
    const signed = o.sign === "PLUS" ? o.value : -o.value;
    d =
      o.unit === "MONTHS"
        ? snap
          ? addMonthsRule(d, signed, ctx)
          : addMonthsExact(d, signed)
        : addDays(d, signed);
  }
  return d;
}
