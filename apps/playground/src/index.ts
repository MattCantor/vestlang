import { parseVestingDSL } from "@vestlang/core";

const input = `define {
  schedule time_based over 1 year every 3 months
}`.trim();

const parsed = parseVestingDSL(input);
console.dir(parsed, { depth: null });
