import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RESOURCES } from "../src/resources.js";

// Guards the wiring that started #44: a published MCP resource whose `path`
// silently points at a moved or deleted file. Every registered resource must
// resolve to a readable, non-empty file under the repo root. Mirrors the path
// resolution in registerResources (resources.ts).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("MCP resources", () => {
  it("registers at least one resource", () => {
    expect(RESOURCES.length).toBeGreaterThan(0);
  });

  it.each(RESOURCES.map((r) => [r.name, r.path] as [string, string]))(
    "%s resolves to a non-empty file",
    (_name, path) => {
      const text = readFileSync(resolve(REPO_ROOT, path), "utf8");
      expect(text.trim().length).toBeGreaterThan(0);
    },
  );
});
