import { NodeExprTag, ScheduleExprTag } from "./enums.js";

// The internal `type` tag of a selector node distinguishes the schedule layer
// from the node layer (e.g. SCHEDULE_EARLIER_OF vs NODE_EARLIER_OF), but a
// reader of the rendered DSL — or of a diagnostic message — should only ever see
// the plain keyword "EARLIER OF" / "LATER OF". This maps the tag back to that
// keyword so the layer prefix never leaks into anything user-facing.

type SelectorExprTag = Exclude<
  ScheduleExprTag | NodeExprTag,
  "SCHEDULE" | "NODE"
>;

export function selectorKeyword(
  tag: SelectorExprTag,
): "EARLIER OF" | "LATER OF" {
  return tag === "SCHEDULE_EARLIER_OF" || tag === "NODE_EARLIER_OF"
    ? "EARLIER OF"
    : "LATER OF";
}
