import { ruleNoDuplicateSelectorItems } from "./no-duplicate-selector-items.js";
import { ruleNoSingletonBool } from "./no-singleton-bool.js";

export const buildInRules = [
  ruleNoSingletonBool,
  ruleNoDuplicateSelectorItems,
] as const;
