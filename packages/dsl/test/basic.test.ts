import { describe, it, expect } from "vitest";
import { parse } from "../src/index";

describe("parser", () => {
  it("parses two-tier sample", () => {
    const s = `
      100 VEST
        SCHEDULE FROM grantDate OVER 4 years EVERY 1 month CLIFF 1 year
        IF ChangeInControl
    `;
    const ast = parse(s);
    expect(ast.amount.value).toBe(100);
    expect(ast.schedule?.over.value).toBe(4);
    expect(ast.schedule?.over.unit).toBe("years");
    expect(ast.if && "kind" in ast.if).toBe(true);
  });
});
