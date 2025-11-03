import { RuleModule } from "../types";

const meta = {
  id: "no-vestingStart-in-from-statement",
  description: "Omit vestingStart (and variants) from from statements.",
  recommended: true,
  severity: "error" as const,
};

export const ruleNoVestingStartInFromStatement: RuleModule = {
  meta,
  create(ctx) {
    const { id, severity } = meta;
    return {
      Schedule(node, path) {
        const vestingStart = node.vesting_start;
        if (!vestingStart || vestingStart.type !== "SINGLETON") return;

        const baseOk =
          vestingStart.base.type === "EVENT" && vestingStart.base.value === "";
      },
    };
  },
};
