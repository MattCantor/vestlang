import { RuleModule } from "../types.js";

const meta = {
  id: "no-vestingStart-in-from-statement",
  description: "Omit vestingStart (and variants) from from statements.",
  recommended: true,
  severity: "error" as const,
};

export const ruleNoVestingStartInFromStatement: RuleModule = {
  meta,
  create(_ctx) {
    return {
      Schedule(node, _path) {
        const vestingStart = node.vesting_start;
        if (!vestingStart || vestingStart.type !== "SINGLETON") return;
      },
    };
  },
};
