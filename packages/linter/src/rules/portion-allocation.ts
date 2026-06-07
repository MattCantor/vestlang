import { RuleModule } from "../types.js";
import { fracCmp, fracSum, ONE } from "@vestlang/utils";

const meta = {
  id: "portion-allocation",
  description:
    "In a multi-statement program, PORTION amounts must not over-allocate the grant (>100% is an error) and should add up to the whole (under 100% is a warning).",
  recommended: true,
  severity: "error" as const,
};

const pct = (num: number, den: number) => `${Math.round((num / den) * 100)}%`;

export const rulePortionAllocation: RuleModule = {
  meta,
  create(ctx) {
    const { id } = meta;
    return {
      Program(program) {
        // A single bare statement defaulting to 100% is correct; only a
        // program of two or more statements can misallocate.
        if (program.length < 2) return;

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

        const { numerator, denominator } = fracSum(portions);
        const cmp = fracCmp({ numerator, denominator }, ONE);
        if (cmp > 0) {
          ctx.report({
            ruleId: id,
            message: `portion amounts sum to ${numerator}/${denominator} (${pct(numerator, denominator)}), over-allocating the grant`,
            severity: "error",
            path: ["Program"],
          });
        } else if (cmp < 0) {
          ctx.report({
            ruleId: id,
            message: `portion amounts sum to ${numerator}/${denominator} (${pct(numerator, denominator)}); the grant is not fully allocated`,
            severity: "warning",
            path: ["Program"],
          });
        }
      },
    };
  },
};
