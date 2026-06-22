import { MAX_INSTALLMENTS, installmentCapMessage } from "@vestlang/primitives";
import { programInstallmentTotal } from "@vestlang/walk";
import { RuleModule } from "../types.js";

const meta = {
  id: "installment-cap",
  description:
    "A program may expand to at most 10000 installments across all its statements; anything larger is refused at evaluation time, so it can never be evaluated.",
  recommended: true,
  severity: "error" as const,
};

export const ruleInstallmentCap: RuleModule = {
  meta,
  create(ctx) {
    const { id, severity } = meta;
    return {
      Program(program) {
        const total = programInstallmentTotal(program);
        if (total > MAX_INSTALLMENTS) {
          ctx.report({
            ruleId: id,
            message: installmentCapMessage(total),
            severity,
            path: ["Program"],
          });
        }
      },
    };
  },
};
