import { afterEach, describe, expect, it } from "vitest";
import { inspect } from "../src/inspect.js";
import { spyConsoleAndExit, type Spies } from "./harness.js";

// A real, parseable schedule so the action exercises the actual parser.
const HAPPY_DSL = "VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month";

describe("inspect action", () => {
  let spies: Spies;
  afterEach(() => spies?.restore());

  it("prints the raw AST as parseable JSON and returns normally", () => {
    spies = spyConsoleAndExit();
    // Happy path: inspect does NOT exit on success, so no throw expected.
    inspect([HAPPY_DSL], {});
    const parsed = JSON.parse(spies.stdout());
    expect(typeof parsed).toBe("object");
    expect(parsed).not.toBeNull();
  });

  it("routes a syntactically invalid input through fail() — error: line, exit 1", () => {
    spies = spyConsoleAndExit();
    expect(() => inspect(["this is not vestlang"], {})).toThrow(/__exit__:1/);
    expect(spies.stderr()).toMatch(/^error: /m);
    expect(spies.exitCode()).toBe(1);
  });
});
