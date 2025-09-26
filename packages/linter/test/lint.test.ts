import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { lint } from "../src/index";

describe("linter rules", () => {
  it("flags singleton IF AFTER (prefer schedule one-shot)", () => {
    const issues = lint(parse(`100 VEST IF AFTER 12 months`));
    expect(issues.length).toBe(1);
    expect(issues[0].code).toBe("PREFER_SCHEDULE_ONE_SHOT");
    expect(issues[0].fix).toMatch(
      /SCHEDULE FROM grantDate OVER 12 months EVERY 12 months/i,
    );
  });

  it("does NOT flag when already a one-shot schedule (no IF)", () => {
    const issues = lint(
      parse(`100 VEST SCHEDULE FROM grantDate OVER 12 months EVERY 12 months`),
    );
    expect(issues.length).toBe(0);
  });

  it("flags IF AFTER even when a non-one-shot schedule is present (author likely misusing IF for time gate)", () => {
    // This matches our current linter logic: discourage using IF AFTER to express a time gate
    // when the intent is time-based—prefer putting time in SCHEDULE.
    const issues = lint(
      parse(`
      100 VEST
      SCHEDULE FROM grantDate OVER 48 months EVERY 1 month
      IF AFTER 12 months
    `),
    );
    expect(issues.length).toBe(1);
    expect(issues[0].code).toBe("PREFER_SCHEDULE_ONE_SHOT");
  });

  it("does NOT flag event-based IF", () => {
    const issues = lint(
      parse(`
      100 VEST
      SCHEDULE FROM grantDate OVER 48 months EVERY 1 month
      IF ChangeInControl
    `),
    );
    expect(issues.length).toBe(0);
  });

  it("does NOT flag composite IF with events (legitimate use of IF)", () => {
    const issues = lint(
      parse(`
      100 VEST
      SCHEDULE FROM grantDate OVER 48 months EVERY 1 month
      IF EARLIER OF ( ChangeInControl, AFTER 12 months )
    `),
    );
    // Our simple rule still flags an AFTER-only case; with composites it's acceptable.
    // Because our linter only flags IF when it's a singleton After, this should be 0.
    expect(issues.length).toBe(0);
  });
});
