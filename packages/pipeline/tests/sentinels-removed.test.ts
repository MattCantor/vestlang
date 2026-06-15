// The two far-future sentinels that used to force structure resolution past
// "now" are gone: removing the observation date from the structure path deleted
// `MAX_REPRESENTABLE_DATE` from offset resolution and `"2999-12-31"` from the
// inferrer's coincident-cliff probe. Both were inert, so removal is behavior-
// neutral; this is the regression guard that they don't creep back.
//
// `MAX_REPRESENTABLE_DATE`'s removal from @vestlang/utils is enforced separately
// by knip (an unused export fails the build), so this only checks the call sites.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relFromTests: string): string =>
  readFileSync(fileURLToPath(new URL(relFromTests, import.meta.url)), "utf8");

describe("the structure-path date sentinels are gone", () => {
  it("resolve-offset.ts no longer references MAX_REPRESENTABLE_DATE", () => {
    const src = read("../src/resolve-offset.ts");
    expect(src).not.toContain("MAX_REPRESENTABLE_DATE");
  });

  it("the inferrer's coincident-cliff probe no longer uses the 2999 sentinel", () => {
    const src = read("../../inferrer/src/coincidentCliff.ts");
    expect(src).not.toContain("2999-12-31");
  });
});
