import { describe, it, expect } from "vitest";
import { POLICY_CANDIDATES } from "../src/policy.js";

// The auto-search candidate set is exactly the three policies inference is
// allowed to originate — DEFAULT first. VESTING_START_DAY_MINUS_ONE is excluded
// not because it can't be projected (it can, and a caller-supplied hint is
// threaded through), but because for start days ≤ 28 it is indistinguishable
// from VESTING_START_DAY seeded a day earlier, so auto-searching it would
// mislabel ordinary schedules; recovering it from end-of-month streams is filed
// separately (#503). A drifted candidate set — gaining MINUS_ONE, or dropping a
// computable policy — would silently change what conventions inference can detect.
describe("POLICY_CANDIDATES", () => {
  it("is exactly the three computable policies, DEFAULT first", () => {
    expect([...POLICY_CANDIDATES]).toEqual([
      "VESTING_START_DAY",
      "FIRST_DAY_OF_MONTH",
      "LAST_DAY_OF_MONTH",
    ]);
  });

  it("excludes VESTING_START_DAY_MINUS_ONE from the auto-search", () => {
    expect(POLICY_CANDIDATES).not.toContain("VESTING_START_DAY_MINUS_ONE");
  });
});
