import { parseVestingDSL } from "@vestlang/core";

const input = `schedule time_based {
  cliff 12months: 25%
}`;

const parsed = parseVestingDSL(input);
console.dir(parsed, { depth: null });
