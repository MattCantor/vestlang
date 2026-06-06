import { ruleCliffExceedsSpan } from "./cliff-exceeds-span.js";
import { rulePortionAllocation } from "./portion-allocation.js";

export const buildInRules = [
  rulePortionAllocation,
  ruleCliffExceedsSpan,
] as const;
