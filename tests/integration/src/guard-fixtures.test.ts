// Exercises the publish guard's pure scanner against synthesized inputs — never
// the live tree — so every violation class it must catch is pinned, including the
// inline `import("…")` form a resolve failure emits (which a from-clause-only scan
// would wave through).
import { describe, expect, it } from "vitest";
import {
  findViolations,
  type PackageScan,
} from "../../../scripts/check-published-artifacts.mjs";

const PRIVATE = new Set(["@vestlang/primitives"]);

function scan(overrides: Partial<PackageScan>): PackageScan {
  return {
    name: "@vestlang/publishable",
    runtimeDeps: [],
    artifacts: [],
    ...overrides,
  };
}

describe("publish guard scanner", () => {
  it("flags a private package imported via a from clause in declarations", () => {
    const violations = findViolations(
      scan({
        artifacts: [
          {
            path: "dist/index.d.ts",
            content: `import { RawEvent } from '@vestlang/primitives';\nexport declare const e: RawEvent;`,
          },
        ],
      }),
      PRIVATE,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("unresolved-specifier");
    expect(violations[0].message).toContain("@vestlang/primitives");
  });

  it("flags a private package hidden in an inline import(...) type reference", () => {
    const violations = findViolations(
      scan({
        artifacts: [
          {
            path: "dist/index.d.ts",
            content: `export declare const e: import("@vestlang/primitives").RawEvent;`,
          },
        ],
      }),
      PRIVATE,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("unresolved-specifier");
    expect(violations[0].message).toContain("@vestlang/primitives");
  });

  it("flags a private require in built JS", () => {
    const violations = findViolations(
      scan({
        artifacts: [
          {
            path: "dist/index.cjs",
            content: `"use strict";\nconst p = require("@vestlang/primitives");`,
          },
        ],
      }),
      PRIVATE,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("unresolved-specifier");
  });

  it("flags a private workspace package sitting in a runtime dep field", () => {
    const violations = findViolations(
      scan({ runtimeDeps: ["@vestlang/primitives"] }),
      PRIVATE,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("private-runtime-dep");
    expect(violations[0].message).toContain("@vestlang/primitives");
  });

  it("accepts a subpath import (zod/mini) when the base package is a dep", () => {
    const violations = findViolations(
      scan({
        runtimeDeps: ["zod"],
        artifacts: [
          {
            path: "dist/index.d.ts",
            content: `import { z } from 'zod/mini';\nexport declare const s: z.ZodType;`,
          },
        ],
      }),
      PRIVATE,
    );
    expect(violations).toEqual([]);
  });

  it("accepts Node builtins with and without the node: prefix", () => {
    const violations = findViolations(
      scan({
        artifacts: [
          {
            path: "dist/index.js",
            content: `import { readFileSync } from "node:fs";\nconst path = require("path");`,
          },
        ],
      }),
      PRIVATE,
    );
    expect(violations).toEqual([]);
  });
});
