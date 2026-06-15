import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";
import { parseEvent } from "../src/utils.js";

describe("parseEvent", () => {
  it("rejects impossible calendar dates the shape regex lets through", () => {
    expect(() => parseEvent("ipo=2025-02-31")).toThrow(InvalidArgumentError);
    expect(() => parseEvent("ipo=2025-13-01")).toThrow(InvalidArgumentError);
  });

  it("accepts a real date into a single-entry record", () => {
    expect(parseEvent("ipo=2025-01-10")).toEqual({ ipo: "2025-01-10" });
  });

  it("accumulates into the prior record (the commander reducer contract)", () => {
    expect(parseEvent("b=2025-02-02", { a: "2025-01-01" })).toEqual({
      a: "2025-01-01",
      b: "2025-02-02",
    });
  });

  it("rejects a malformed flag with no =date", () => {
    expect(() => parseEvent("ipo")).toThrow(InvalidArgumentError);
  });
});
