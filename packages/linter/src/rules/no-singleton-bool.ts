import { RuleModule } from "../types";

const meta = {
  id: "no-singleton-bool",
  description: "Avoid AND/OR with a single child; write the child directly.",
  recommended: true,
  severity: "warning" as const,
};

export const ruleNoSingletonBool: RuleModule = {
  meta,
  create(ctx) {
    const { id, severity } = meta;
    return {
      AndCondition(node, path) {
        if (node.items.length === 1) {
          ctx.report({
            ruleId: id,
            message: "AND with one item is redundant; remove the AND.",
            severity,
            path,
          });
        }
      },
      OrCondition(node, path) {
        if (node.items.length === 1) {
          ctx.report({
            ruleId: id,
            message: "OR with one item is redundant; remove the OR.",
            severity,
            path,
          });
        }
      },
    };
  },
};
