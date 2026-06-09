import type { NodeExprTag, ScheduleExprTag } from "@vestlang/types";

// Maps a selector node's `type` tag to its surface keyword. The two layers read
// differently on purpose: the node layer (inside FROM / CLIFF) chooses between
// anchors and prints "EARLIER OF" / "LATER OF"; the schedule layer chooses between
// whole schedules by vesting start and prints "EARLIER START OF" / "LATER START OF",
// the START naming the comparison key so the two don't look identical.

type SelectorExprTag = Exclude<
  ScheduleExprTag | NodeExprTag,
  "SCHEDULE" | "NODE"
>;

export function selectorKeyword(
  tag: SelectorExprTag,
): "EARLIER OF" | "LATER OF" | "EARLIER START OF" | "LATER START OF" {
  switch (tag) {
    case "NODE_EARLIER_OF":
      return "EARLIER OF";
    case "NODE_LATER_OF":
      return "LATER OF";
    case "SCHEDULE_EARLIER_OF":
      return "EARLIER START OF";
    case "SCHEDULE_LATER_OF":
      return "LATER START OF";
  }
}
