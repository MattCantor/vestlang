import { RuleModule } from "../types.js";

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
    // Note: on a *normalized* program this never fires — the normalizer already
    // collapses a one-item AND/OR to its child before the linter runs. It would
    // only catch something if a rule ran against the raw AST. Tracked in #53;
    // left in place, not relied upon.
    return {
      AND(node, path) {
        if (node.items.length === 1) {
          ctx.report({
            ruleId: id,
            message: "AND with one item is redundant; remove the AND.",
            severity,
            path,
          });
        }
      },
      OR(node, path) {
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
