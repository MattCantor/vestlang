import { describe, it, expect } from "vitest";
import { parse } from "../src/index";

describe("dsl parser", () => {
  it("parses a pure time schedule (4y monthly)", () => {
    const ast = parse(
      `100 VEST SCHEDULE FROM grantDate OVER 48 months EVERY 1 month`,
    );
    expect(ast.amount.value).toBe(100);
    expect(ast.top.kind).toBe("Program");
    const p = ast.top as any;
    expect(p.schedule).toBeTruthy();
    expect(p.schedule.from.kind).toBe("Event");
    expect(p.schedule.from.name).toBe("grantDate");
    expect(p.schedule.over.value).toBe(48);
    expect(p.schedule.over.unit).toBe("months");
    expect(p.schedule.every.value).toBe(1);
    expect(p.schedule.every.unit).toBe("months");
    expect(p.schedule.cliff.kind).toBe("Zero"); // default
    expect(p.if ?? null).toBeNull();
  });

  it("parses nested IF: EARLIER(LATER(CIC, +18m), EARLIER(2027-01-01, +12m))", () => {
    const ast = parse(`
      100 VEST
        SCHEDULE FROM grantDate OVER 4 months EVERY 1 month
        IF EARLIER OF (
             LATER OF ( ChangeInControl, AFTER 18 months ),
             EARLIER OF ( AT 2027-01-01, AFTER 12 months )
        )
    `);
    const p = ast.top as any;
    expect(p.kind).toBe("Program");
    expect(p.if.kind).toBe("EarlierOf");
    expect(Array.isArray(p.if.items)).toBe(true);
    expect(p.if.items.length).toBe(2);
    expect(p.if.items[0].kind).toBe("LaterOf");
    expect(p.if.items[0].items[0].kind).toBe("Event");
    expect(p.if.items[0].items[0].name).toBe("ChangeInControl");
    expect(p.if.items[0].items[1].kind).toBe("After");
    expect(p.if.items[0].items[1].duration.value).toBe(18);
    expect(p.if.items[1].kind).toBe("EarlierOf");
    // inner 'AT' date
    expect(p.if.items[1].items[0].kind).toBe("At");
    expect(p.if.items[1].items[0].date.iso).toBe("2027-01-01");
    // inner 'AFTER'
    expect(p.if.items[1].items[1].kind).toBe("After");
    expect(p.if.items[1].items[1].duration.value).toBe(12);
  });

  it("parses top-level LATER OF over two programs", () => {
    const ast = parse(`
      100 VEST LATER OF (
        SCHEDULE FROM grantDate OVER 4 months EVERY 1 month CLIFF 12 months IF ChangeInControl,
        SCHEDULE FROM grantDate OVER 3 months EVERY 3 months
      )
    `);
    expect(ast.top.kind).toBe("LaterOfPrograms");
    const node = ast.top as any;
    expect(node.items.length).toBe(2);
    expect(node.items[0].kind).toBe("Program");
    expect(node.items[1].kind).toBe("Program");
    expect(node.items[0].schedule.cliff.value ?? 12).toBe(12);
    expect(node.items[0].if.kind).toBe("Event");
  });

  it("parses IF-only one-shot (no SCHEDULE)", () => {
    const ast = parse(`100 VEST IF AT 2026-01-01`);
    expect(ast.top.kind).toBe("Program");
    const p = ast.top as any;
    expect(p.schedule).toBeNull();
    expect(p.if.kind).toBe("At");
    expect(p.if.date.iso).toBe("2026-01-01");
  });
});
