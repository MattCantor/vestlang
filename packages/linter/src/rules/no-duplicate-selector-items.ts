import {
  EarlierOfSchedule,
  EarlierOfVestingNode,
  LaterOfSchedule,
  LaterOfVestingNode,
  selectorKeyword,
} from "@vestlang/types";
import { LintContext, NodePath, RuleModule } from "../types.js";

const meta = {
  id: "no-duplicate-selector-items",
  description:
    "Selectors (EARLIER OF / LATER OF) should not repeat the same item.",
  recommended: true,
  severity: "warning" as const,
};

// A selector at either layer: EARLIER/LATER OF over schedules, or over vesting
// nodes. The duplicate check is identical for all four, so one handler covers
// them; we only ever read `.type` (for the keyword) and the `.items` list.
type Selector =
  | EarlierOfSchedule
  | LaterOfSchedule
  | EarlierOfVestingNode
  | LaterOfVestingNode;

export const ruleNoDuplicateSelectorItems: RuleModule = {
  meta,
  create(ctx: LintContext) {
    const { id, severity } = meta;

    const check = (node: Selector, path: NodePath) => {
      const seen = new Set<string>();
      for (let i = 0; i < node.items.length; i++) {
        const k = ctx.stableKey(node.items[i]);
        if (seen.has(k)) {
          ctx.report({
            ruleId: id,
            // The keyword, not the internal tag: a reader sees "EARLIER OF",
            // never "SCHEDULE_EARLIER_OF".
            message: `${selectorKeyword(node.type)} contains duplicate items`,
            severity,
            path: path.concat("items", i),
          });
        } else {
          seen.add(k);
        }
      }
    };

    return {
      SCHEDULE_EARLIER_OF: check,
      SCHEDULE_LATER_OF: check,
      NODE_EARLIER_OF: check,
      NODE_LATER_OF: check,
    };
  },
};
