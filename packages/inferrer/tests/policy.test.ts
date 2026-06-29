import { describe, it, expect } from "vitest";
import { POLICY_CANDIDATES } from "../src/policy.js";

// The auto-search candidate set is exactly the three day-of-month policies the
// stepper can project — DEFAULT first. VESTING_START_DAY_MINUS_ONE is deliberately
// excluded: its day math isn't implemented yet (#493), so inference must never
// originate it (a caller-supplied hint is still threaded, and throws at projection
// time). A drifted candidate set — gaining MINUS_ONE, or dropping a computable
// policy — would silently change what conventions inference can detect.
describe("POLICY_CANDIDATES", () => {
  it("is exactly the three computable policies, DEFAULT first", () => {
    expect([...POLICY_CANDIDATES]).toEqual([
      "VESTING_START_DAY",
      "FIRST_DAY_OF_MONTH",
      "LAST_DAY_OF_MONTH",
    ]);
  });

  it("excludes the uncomputable VESTING_START_DAY_MINUS_ONE", () => {
    expect(POLICY_CANDIDATES).not.toContain("VESTING_START_DAY_MINUS_ONE");
  });
});
