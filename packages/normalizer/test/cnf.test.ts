import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { toCNF } from "../src/index";

describe("normalizer (CNF)", () => {
  it("injects a one-shot schedule for IF-only", () => {
    const cnf = toCNF(parse(`100 VEST IF AT 2026-01-01`));
    // cnf.top is Program after normalization
    expect(cnf.top.kind).toBe("Program");
    const p = cnf.top as any;
    expect(p.schedule).toBeTruthy();
    expect(p.schedule.from.kind).toBe("Event");
    expect(p.schedule.from.name).toBe("grantDate");
    expect(p.schedule.over.value).toBe(0);
    expect(p.schedule.every.value).toBe(0);
    expect(p.schedule.cliff.kind).toBe("Zero");
    expect(p.if.kind).toBe("At");
  });

  it("flattens nested EarlierOfPrograms at the top level", () => {
    const cnf = toCNF(
      parse(`
      100 VEST EARLIER OF (
        EARLIER OF (
          SCHEDULE OVER 48 months EVERY 1 month,
          SCHEDULE OVER 36 months EVERY 3 months
        ),
        SCHEDULE OVER 6 months EVERY 1 month
      )
    `),
    );
    expect(cnf.top.kind).toBe("EarlierOfPrograms");
    const node = cnf.top as any;
    expect(node.items.length).toBe(3);
    // ensure no nested EarlierOfPrograms remain
    expect(node.items.every((x: any) => x.kind === "Program")).toBe(true);
  });

  it("flattens nested EarlierOf in IF block", () => {
    const cnf = toCNF(
      parse(`
      100 VEST
        SCHEDULE OVER 48 months EVERY 1 month
        IF EARLIER OF ( EARLIER OF ( AT 2027-01-01, AFTER 12 months ), ChangeInControl )
    `),
    );
    const p = cnf.top as any;
    expect(p.if.kind).toBe("EarlierOf");
    expect(p.if.items.length).toBe(3);
    const kinds = p.if.items.map((x: any) => x.kind).sort();
    expect(kinds).toEqual(["After", "At", "Event"].sort());
  });

  it("defaults CLIFF to Zero when omitted", () => {
    const cnf = toCNF(
      parse(`100 VEST SCHEDULE OVER 12 months EVERY 12 months`),
    );
    const p = cnf.top as any;
    expect(p.schedule.cliff.kind).toBe("Zero");
  });
});
