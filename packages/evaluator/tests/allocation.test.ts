import { describe, it, expect } from "vitest";
import { allocateQuantity } from "../src/evaluate/allocation";

describe("allocateQuantity", () => {
  it("n <= 0 returns []", () => {
    expect(allocateQuantity(100, 0, "CUMULATIVE_ROUND_DOWN")).toEqual([]);
  });

  it("CUMULATIVE_ROUNDING sums to quantity", () => {
    const result = allocateQuantity(100, 6, "CUMULATIVE_ROUNDING");
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("FRONT_LOADED remainder lands at the front", () => {
    expect(allocateQuantity(10, 4, "FRONT_LOADED")).toEqual([3, 3, 2, 2]);
  });

  it("BACK_LOADED remainder lands at the back", () => {
    expect(allocateQuantity(10, 4, "BACK_LOADED")).toEqual([2, 2, 3, 3]);
  });

  it("FRONT_LOADED_TO_SINGLE_TRANCHE", () => {
    expect(allocateQuantity(10, 4, "FRONT_LOADED_TO_SINGLE_TRANCHE")).toEqual([
      4, 2, 2, 2,
    ]);
  });

  it("BACK_LOADED_TO_SINGLE_TRANCHE", () => {
    expect(allocateQuantity(10, 4, "BACK_LOADED_TO_SINGLE_TRANCHE")).toEqual([
      2, 2, 2, 4,
    ]);
  });
});
