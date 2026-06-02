import { ruleCliffExceedsSpan } from "./cliff-exceeds-span.js";
import { ruleNoDuplicateSelectorItems } from "./no-duplicate-selector-items.js";
import { ruleNoSingletonBool } from "./no-singleton-bool.js";
import { rulePortionAllocation } from "./portion-allocation.js";

export const buildInRules = [
  ruleNoSingletonBool,
  ruleNoDuplicateSelectorItems,
  rulePortionAllocation,
  ruleCliffExceedsSpan,
] as const;
