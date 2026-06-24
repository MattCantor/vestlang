import { describe, it, expect } from "vitest";
import { selectorKeyword } from "../src/display";

// The two selector layers print different surface keywords on purpose: a node
// selector (inside FROM / CLIFF) reads "EARLIER OF" / "LATER OF"; a whole-schedule
// selector reads "EARLIER START OF" / "LATER START OF", the START naming the
// comparison key. These keywords are DSL surface syntax, so they're a contract.
describe("selectorKeyword", () => {
  it("maps node selectors to OF and schedule selectors to START OF", () => {
    expect(selectorKeyword("NODE_EARLIER_OF")).toBe("EARLIER OF");
    expect(selectorKeyword("NODE_LATER_OF")).toBe("LATER OF");
    expect(selectorKeyword("SCHEDULE_EARLIER_OF")).toBe("EARLIER START OF");
    expect(selectorKeyword("SCHEDULE_LATER_OF")).toBe("LATER START OF");
  });
});
