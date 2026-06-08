import { describe, it, expect } from "vitest";
import { assertNever } from "../src/assert";

describe("assertNever", () => {
  it("throws on a value that should have been unreachable", () => {
    expect(() => assertNever({ type: "BOGUS" } as never)).toThrow();
  });
});
