import { ruleCliffExceedsSpan } from "./cliff-exceeds-span.js";
import { ruleInstallmentCap } from "./installment-cap.js";
import { rulePortionAllocation } from "./portion-allocation.js";
import { ruleUnsatisfiableDateWindow } from "./unsatisfiable-date-window.js";

export const buildInRules = [
  rulePortionAllocation,
  ruleCliffExceedsSpan,
  ruleInstallmentCap,
  ruleUnsatisfiableDateWindow,
] as const;
