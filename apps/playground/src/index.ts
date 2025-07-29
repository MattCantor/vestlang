import { parse } from "@vestlang/core";

const input = `
define schedule time_based:
  monthly for 4 years with 1 year cliff
`;

const result = parse(input);
console.log("Parsed result:", result);
