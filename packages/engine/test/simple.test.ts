import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { evaluate } from "../src";

const GRANT = new Date("2025-01-01T00:00:00Z");

function ctx(extra: Record<string, Date> = {}) {
  return { events: { grantDate: GRANT, ...extra } };
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

describe("engine simple cases", () => {
  it("pure time schedule: 4y monthly (first installment is 2025-02-01)", () => {
    const stmt = parse(`
      100 VEST
        SCHEDULE FROM grantDate OVER 4 years EVERY 1 month
    `);
    const out = evaluate(stmt, ctx());
    expect(iso(out[0].at)).toBe("2025-02-01"); // first monthly step
  });

  it("time schedule + 1y cliff (first release at 2026-01-01)", () => {
    const stmt = parse(`
      100 VEST
        SCHEDULE FROM grantDate OVER 4 years EVERY 1 month CLIFF 1 year
    `);
    const out = evaluate(stmt, ctx());
    expect(iso(out[0].at)).toBe("2026-01-01"); // backlog released at cliff
  });

  it("one-shot IF AT <date> (100% on that date)", () => {
    const stmt = parse(`100 VEST IF AT 2026-03-15`);
    const out = evaluate(stmt, ctx());
    expect(out.length).toBe(1);
    expect(iso(out[0].at)).toBe("2026-03-15");
    expect(out[0].vestedPercent).toBe(100);
  });

  it("one-shot IF AFTER 1 year (100% at grant+1y)", () => {
    const stmt = parse(`100 VEST IF AFTER 1 year`);
    const out = evaluate(stmt, ctx());
    expect(out.length).toBe(1);
    expect(iso(out[0].at)).toBe("2026-01-01");
    expect(out[0].vestedPercent).toBe(100);
  });

  it("schedule starts at event (FROM ChangeInControl)", () => {
    const stmt = parse(`
      100 VEST
        SCHEDULE FROM ChangeInControl OVER 4 years EVERY 1 month
    `);
    const out = evaluate(
      stmt,
      ctx({ ChangeInControl: new Date("2027-01-01T00:00:00Z") }),
    );
    expect(iso(out[0].at)).toBe("2027-02-01"); // first month after CIC
  });
});
