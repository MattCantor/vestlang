import { RuleModule } from "../types.js";
import { classifyAllocation, formatPct, fracSum } from "@vestlang/utils";

const meta = {
  id: "portion-allocation",
  description:
    "PORTION amounts must not over-allocate the grant (>100% is an error) and should add up to the whole (under 100% is a warning).",
  recommended: true,
  severity: "error" as const,
};

export const rulePortionAllocation: RuleModule = {
  meta,
  create(ctx) {
    const { id } = meta;
    return {
      Program(program) {
        const portions = program
          .map((s) => s.amount)
          .filter((a) => a.type === "PORTION");
        const hasQuantity = program.some((s) => s.amount.type === "QUANTITY");

        // Mixed (or all-quantity) programs can't be summed without a grant
        // total, so quantity allocation is out of scope. But a portion claiming
        // the whole grant alongside any sibling is unambiguously wrong, so still
        // flag a lone 1/1 (this is what catches a bare amount in a mixed program).
        if (hasQuantity) {
          program.forEach((s, i) => {
            const a = s.amount;
            if (a.type === "PORTION" && a.numerator === a.denominator) {
              ctx.report({
                ruleId: id,
                message:
                  "statement claims 100% of the grant alongside other statements",
                severity: "error",
                path: ["Program", i],
              });
            }
          });
          return;
        }

        const sum = fracSum(portions);
        const { numerator, denominator } = sum;
        const where = classifyAllocation(sum);
        if (where === "over") {
          ctx.report({
            ruleId: id,
            message: `portion amounts sum to ${numerator}/${denominator} (${formatPct(sum)}), over-allocating the grant`,
            severity: "error",
            path: ["Program"],
          });
        } else if (where === "under") {
          ctx.report({
            ruleId: id,
            message: `portion amounts sum to ${numerator}/${denominator} (${formatPct(sum)}); the grant is not fully allocated`,
            severity: "warning",
            path: ["Program"],
          });
        }
      },
    };
  },
};
