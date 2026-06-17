import { afterEach, describe, expect, it } from "vitest";
import { compile } from "../src/compile.js";
import { spyConsoleAndExit, type Spies } from "./harness.js";

const HAPPY_DSL = "VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month";

describe("compile action", () => {
  let spies: Spies;
  afterEach(() => spies?.restore());

  it("prints the normalized program as parseable JSON and returns normally", () => {
    spies = spyConsoleAndExit();
    compile([HAPPY_DSL], {});
    const parsed = JSON.parse(spies.stdout());
    expect(typeof parsed).toBe("object");
    expect(parsed).not.toBeNull();
  });

  it("routes an invalid input through fail() — error: line, exit 1", () => {
    spies = spyConsoleAndExit();
    expect(() => compile(["this is not vestlang"], {})).toThrow(/__exit__:1/);
    expect(spies.stderr()).toMatch(/^error: /m);
    expect(spies.exitCode()).toBe(1);
  });
});
