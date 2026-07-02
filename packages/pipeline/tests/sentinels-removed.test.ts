// The two far-future sentinels that used to force structure resolution past
// "now" are gone: removing the observation date from the structure path deleted
// `MAX_REPRESENTABLE_DATE` from offset resolution and `"2999-12-31"` from the
// inferrer's coincident-cliff probe. Both were inert, so removal is behavior-
// neutral; this is the regression guard that they don't creep back.
//
// `MAX_REPRESENTABLE_DATE`'s removal from @vestlang/utils is enforced separately
// by knip (an unused export fails the build). The coincident-cliff probe module
// itself was retired with the inferrer's analytic rebuild, so the sentinel guard
// now scans the whole inferrer source tree rather than that one deleted file.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relFromTests: string): string =>
  readFileSync(fileURLToPath(new URL(relFromTests, import.meta.url)), "utf8");

function tsFiles(dirUrl: URL): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dirUrl, { withFileTypes: true })) {
    const child = new URL(
      `${entry.name}${entry.isDirectory() ? "/" : ""}`,
      dirUrl,
    );
    if (entry.isDirectory()) out.push(...tsFiles(child));
    else if (entry.name.endsWith(".ts")) out.push(fileURLToPath(child));
  }
  return out;
}

describe("the structure-path date sentinels are gone", () => {
  it("resolve-offset.ts no longer references MAX_REPRESENTABLE_DATE", () => {
    const src = read("../src/resolve-offset.ts");
    expect(src).not.toContain("MAX_REPRESENTABLE_DATE");
  });

  it("the inferrer source no longer uses the 2999 sentinel", () => {
    const inferrerSrc = new URL("../../inferrer/src/", import.meta.url);
    for (const file of tsFiles(inferrerSrc)) {
      expect(readFileSync(file, "utf8")).not.toContain("2999-12-31");
    }
  });
});
