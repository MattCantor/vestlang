import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { toCNF } from "../src";

describe("CNF", () => {
  it("injects one-shot schedule when only IF", () => {
    const s = `100 VEST IF AT 2026-01-01`;
    const cnf = toCNF(parse(s));
    expect(cnf.schedule?.over.value).toBe(0);
    expect(cnf.if).toBeTruthy();
  });
});
