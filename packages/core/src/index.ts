import {parse } from "./generated/parser.js";

export function parseVestingDSL(input: string) {
  return parse(input);
}


