// Issue #441 (AC7): the `scheduled` breakdown field is documented on BOTH
// MCP-facing surfaces — the `vestlang_evaluate` tool description and the live
// `evaluation.md` MCP resource. Asserting under the full suite (precedent:
// sentinels-removed.test.ts) so a field/shape change can't silently skip the docs.
// Beyond the field name, the present-iff-folded RULE is pinned via one verbatim
// phrase authored into both surfaces.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relFromTests: string): string =>
  readFileSync(fileURLToPath(new URL(relFromTests, import.meta.url)), "utf8");

const RULE =
  "present only when at least one tranche was pulled forward onto the grant date";

describe("#441 — scheduled is documented on the MCP surfaces", () => {
  it("the vestlang_evaluate description names scheduled and its present-iff rule", () => {
    const src = read("../../../apps/mcp-server/src/server.ts");
    expect(src).toContain("scheduled");
    expect(src).toContain(RULE);
  });

  it("evaluation.md documents scheduled and its present-iff rule", () => {
    const doc = read("../../../apps/docs/docs/evaluation.md");
    expect(doc).toContain("scheduled");
    expect(doc).toContain(RULE);
  });
});
