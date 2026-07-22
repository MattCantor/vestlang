import { ruleAmbiguousMonthEndStart } from "./ambiguous-month-end-start.js";
import { ruleCliffExceedsSpan } from "./cliff-exceeds-span.js";
import { ruleInstallmentCap } from "./installment-cap.js";
import { rulePortionAllocation } from "./portion-allocation.js";
import { ruleUnsatisfiableDateWindow } from "./unsatisfiable-date-window.js";
import { ruleUnsatisfiableEventGate } from "./unsatisfiable-event-gate.js";

export const buildInRules = [
  rulePortionAllocation,
  ruleCliffExceedsSpan,
  ruleInstallmentCap,
  ruleUnsatisfiableDateWindow,
  ruleUnsatisfiableEventGate,
  ruleAmbiguousMonthEndStart,
] as const;
