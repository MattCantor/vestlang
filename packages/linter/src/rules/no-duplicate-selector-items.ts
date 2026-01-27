import { RuleModule } from "../types.js";

const meta = {
  id: "no-duplicate-selector-items",
  description:
    "Selectors (EARLIER_OF/LATER_OF) should not repeat the same item.",
  recommended: true,
  severity: "warning" as const,
};

export const ruleNoDuplicateSelectorItems: RuleModule = {
  meta,
  create(ctx) {
    const { id, severity } = meta;
    return {
      ScheduleSelector(node, path) {
        const seen = new Set<string>();
        for (let i = 0; i < node.items.length; i++) {
          const k = ctx.stableKey(node.items[i]);
          if (seen.has(k)) {
            ctx.report({
              ruleId: id,
              message: `${node.type} contains duplicate items`,
              severity,
              path: path.concat("items", i),
            });
          } else {
            seen.add(k);
          }
        }
      },
      VestingNodeSelector(node, path) {
        const seen = new Set<string>();
        for (let i = 0; i < node.items.length; i++) {
          const k = ctx.stableKey(node.items[i]);
          if (seen.has(k)) {
            ctx.report({
              ruleId: id,
              message: `${node.type} constaints duplicate items`,
              severity,
              path: path.concat("items", i),
            });
          } else {
            seen.add(k);
          }
        }
      },
    };
  },
};
