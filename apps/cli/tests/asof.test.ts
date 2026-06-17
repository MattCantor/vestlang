import { afterEach, describe, expect, it } from "vitest";
import { asof } from "../src/asof.js";
import { spyConsoleAndExit, type Spies } from "./harness.js";

const HAPPY_DSL = "VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month";

// Pin the as-of date inside the schedule window. The default as-of is *today*, so
// against a 2025 schedule everything would already be vested and UNVESTED would be
// empty; 2025-06-15 lands mid-schedule so both partitions are populated regardless
// of the wall clock.
const baseOpts = {
  quantity: "1200",
  grantDate: "2025-01-01",
  date: "2025-06-15",
  event: {} as Record<string, string>,
};

describe("asof action", () => {
  let spies: Spies;
  afterEach(() => spies?.restore());

  it("prints the always-on sections plus VESTED and UNVESTED for an in-window date", () => {
    spies = spyConsoleAndExit();
    asof([HAPPY_DSL], baseOpts);
    const out = spies.stdout();
    // Unconditional sections.
    expect(out).toContain("AS OF");
    expect(out).toContain("UNRESOLVED");
    expect(out).toContain("SUMMARY");
    // Length-gated, but the pinned mid-window date populates both.
    expect(out).toContain("VESTED");
    expect(out).toContain("UNVESTED");
  });

  it("routes an invalid quantity through fail() — error: line, exit 1", () => {
    spies = spyConsoleAndExit();
    // "" and "  " coerce to a valid 0; "abc" is a genuine parse failure.
    expect(() => asof([HAPPY_DSL], { ...baseOpts, quantity: "abc" })).toThrow(
      /__exit__:1/,
    );
    expect(spies.stderr()).toMatch(/^error: /m);
    expect(spies.exitCode()).toBe(1);
  });

  it("routes an invalid grant date through fail() — error: line, exit 1", () => {
    spies = spyConsoleAndExit();
    expect(() =>
      asof([HAPPY_DSL], { ...baseOpts, grantDate: "2025-02-31" }),
    ).toThrow(/__exit__:1/);
    expect(spies.stderr()).toMatch(/^error: /m);
    expect(spies.exitCode()).toBe(1);
  });
});
