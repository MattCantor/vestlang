import { describe, expect, it } from "vitest";
import type { VestingDayOfMonth } from "../src/index.js";

// There's no runtime surface yet — the package is just scaffolding at this
// point. This guards the two things scaffolding can actually get wrong: that
// the barrel resolves at all, and that its type re-export compiles. The typed
// sample value fails the build if the re-export breaks.
describe("@vestlang/recover", () => {
  it("re-exports the canonical types a recovered schedule is built from", () => {
    const dayOfMonth: VestingDayOfMonth = "01";
    expect(dayOfMonth).toBe("01");
  });
});
