import { afterEach, describe, expect, it } from "vitest";
import { evaluate } from "../src/evaluate.js";
import { spyConsoleAndExit, type Spies } from "./harness.js";

const HAPPY_DSL = "VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month";

const baseOpts = {
  quantity: "1200",
  grantDate: "2025-01-01",
  event: {} as Record<string, string>,
};

describe("evaluate action", () => {
  let spies: Spies;
  afterEach(() => spies?.restore());

  it("prints both verdict lines and a non-empty installment table", () => {
    spies = spyConsoleAndExit();
    evaluate([HAPPY_DSL], baseOpts);
    const out = spies.stdout();
    // The two side-by-side verdicts the action always renders.
    expect(out).toContain("storable:");
    expect(out).toContain("resolves to:");
    // console.table routes through console.log; a populated schedule shows its
    // column headers and at least one of the twelve monthly installments.
    expect(out).toContain("amount");
    expect(out).toContain("state");
    expect(out).toContain("RESOLVED");
  });

  it("renders the direction-honest absence message for an AFTER gate", () => {
    // `AFTER EVENT ipo` (ipo unfired) leans on ipo NOT having occurred after the
    // start date — the watch-list block must name the *after* side, not on/before.
    spies = spyConsoleAndExit();
    evaluate(
      [
        "VEST FROM DATE 2025-01-01 AFTER EVENT ipo OVER 12 months EVERY 1 month",
      ],
      baseOpts,
    );
    const out = spies.stdout();
    expect(out).toContain("Assumes these events have not yet occurred:");
    expect(out).toContain("ipo did not occur after 2025-01-01");
    expect(out).not.toContain("ipo did not occur on/before");
  });

  // #447 (AC5): a held `LATER OF` cliff discloses its floor in the symbolic-date
  // cell. The floor rides through `JSON.stringify(item.symbolicDate)`, so the
  // printed table contains the resolved +12mo lower bound.
  it("prints the disclosed floor for a held LATER OF cliff", () => {
    spies = spyConsoleAndExit();
    evaluate(
      [
        "VEST FROM grantDate OVER 48 months EVERY 1 month " +
          "CLIFF LATER OF(vestingStart + 12 months, EVENT ipo)",
      ],
      // ipo unfired (no --event), so the whole grid is held symbolically.
      { quantity: "4800", grantDate: "2025-01-01", event: {} },
    );
    const out = spies.stdout();
    expect(out).toContain("UNRESOLVED_CLIFF");
    // The grant-date start grids the first cadence at 2025-02-01, floored at the
    // +12mo mark; both appear verbatim in the stringified symbolic date.
    expect(out).toContain('"floor":"2026-01-01"');
    expect(out).toContain('"date":"2025-02-01"');
  });

  // #447 (AC3/AC5): a bare `CLIFF EVENT e` has no time arm, so no floor — the
  // held tranches' symbolic dates carry no `floor` key in the printed cell.
  it("prints no floor for a held bare-event cliff", () => {
    spies = spyConsoleAndExit();
    evaluate(
      ["VEST FROM grantDate OVER 48 months EVERY 1 month CLIFF EVENT board"],
      { quantity: "4800", grantDate: "2025-01-01", event: {} },
    );
    const out = spies.stdout();
    expect(out).toContain("UNRESOLVED_CLIFF");
    expect(out).not.toContain("floor");
  });

  it("routes an invalid quantity through fail() — error: line, exit 1", () => {
    spies = spyConsoleAndExit();
    expect(() =>
      evaluate([HAPPY_DSL], { ...baseOpts, quantity: "-5" }),
    ).toThrow(/__exit__:1/);
    expect(spies.stderr()).toMatch(/^error: /m);
    expect(spies.exitCode()).toBe(1);
  });

  it("routes an invalid grant date through fail() — error: line, exit 1", () => {
    spies = spyConsoleAndExit();
    expect(() =>
      evaluate([HAPPY_DSL], { ...baseOpts, grantDate: "not-a-date" }),
    ).toThrow(/__exit__:1/);
    expect(spies.stderr()).toMatch(/^error: /m);
    expect(spies.exitCode()).toBe(1);
  });
});
