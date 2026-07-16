// Exercises the publish guard's pure scanner against synthesized inputs — never
// the live tree — so every violation class it must catch is pinned, including the
// inline `import("…")` form a resolve failure emits (which a from-clause-only scan
// would wave through).
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findViolations,
  findWorkspaceRangeViolations,
  packedManifest,
  PackToolingError,
  type PackageScan,
  type PackedManifest,
  type SpawnLike,
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

  it("flags a relative specifier with no file behind it — the #542 shape", () => {
    const violations = findViolations(
      scan({
        artifacts: [
          {
            path: "dist/index.d.ts",
            content: `const z = __importStar(require("./external.cjs"));\n__exportStar(require("./external.cjs"), exports);`,
          },
        ],
      }),
      PRIVATE,
    );
    // Both requires name the same missing file; each occurrence is reported.
    expect(violations).toHaveLength(2);
    expect(violations[0].kind).toBe("unresolved-specifier");
    expect(violations[0].message).toContain("./external.cjs");
  });

  it("accepts a relative specifier that lands on a built file", () => {
    const violations = findViolations(
      scan({
        artifacts: [
          {
            path: "dist/index.js",
            content: `export * from "./chunk-abc.js";`,
          },
          { path: "dist/chunk-abc.js", content: "export const x = 1;" },
        ],
      }),
      PRIVATE,
    );
    expect(violations).toEqual([]);
  });

  it("leaves relative specifiers without a built-file extension unjudged", () => {
    const violations = findViolations(
      scan({
        artifacts: [
          {
            path: "dist/index.js",
            content: `import data from "./data.json";\nimport extless from "./extless";`,
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

describe("packed-manifest workspace-range check", () => {
  it("flags a surviving workspace range with the package, dependency, and literal range", () => {
    const violations = findWorkspaceRangeViolations({
      name: "@vestlang/vestlang",
      dependencies: { "@vestlang/core": "workspace:*", zod: "^4.0" },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("workspace-range");
    expect(violations[0].package).toBe("@vestlang/vestlang");
    expect(violations[0].message).toContain("@vestlang/core");
    expect(violations[0].message).toContain("workspace:*");
  });

  it("flags workspace ranges in peer and optional deps, not just dependencies", () => {
    const violations = findWorkspaceRangeViolations({
      name: "@vestlang/pkg",
      peerDependencies: { "@vestlang/a": "workspace:^" },
      optionalDependencies: { "@vestlang/b": "workspace:~" },
    });
    expect(violations).toHaveLength(2);
    expect(violations.every((v) => v.kind === "workspace-range")).toBe(true);
    const messages = violations.map((v) => v.message).join("\n");
    expect(messages).toContain("workspace:^");
    expect(messages).toContain("workspace:~");
  });

  it("passes a manifest whose ranges were rewritten to concrete versions", () => {
    const violations = findWorkspaceRangeViolations({
      name: "@vestlang/vestlang",
      dependencies: { "@vestlang/core": "0.1.0", zod: "^4.0" },
    });
    expect(violations).toEqual([]);
  });

  it("ignores a workspace range in devDependencies — a consumer never resolves them", () => {
    const violations = findWorkspaceRangeViolations({
      name: "@vestlang/core",
      devDependencies: { "@vestlang/primitives": "workspace:*" },
    } as PackedManifest);
    expect(violations).toEqual([]);
  });
});

// Packing failures are stubbed through the injectable spawn — no real pnpm run,
// no broken workspace needed — so these stay hermetic while pinning that a
// broken tree surfaces as the distinct tooling error, never as a violation.
describe("packed-manifest packing failures", () => {
  function withTempDir(run: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), "guard-fixture-"));
    try {
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("surfaces a failing pack as a tooling error telling the user to install first", () => {
    const failingPack: SpawnLike = () => ({
      status: 1,
      stdout: "",
      stderr: "ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL",
    });
    withTempDir((dest) => {
      expect(() => packedManifest("/pkg", dest, failingPack)).toThrow(
        PackToolingError,
      );
      expect(() => packedManifest("/pkg", dest, failingPack)).toThrow(
        /pnpm install/,
      );
    });
  });

  it("treats a zero-exit pack that produced no tarball as a tooling error too", () => {
    const silentPack: SpawnLike = () => ({ status: 0, stdout: "", stderr: "" });
    withTempDir((dest) => {
      expect(() => packedManifest("/pkg", dest, silentPack)).toThrow(
        PackToolingError,
      );
    });
  });

  it("hands back the manifest tar extracts once the pack lands a tarball", () => {
    const manifest = {
      name: "@vestlang/pkg",
      dependencies: { "@vestlang/core": "0.1.0" },
    };
    const spawn: SpawnLike = (command) =>
      command === "pnpm"
        ? { status: 0, stdout: "", stderr: "" }
        : { status: 0, stdout: JSON.stringify(manifest), stderr: "" };
    withTempDir((dest) => {
      writeFileSync(join(dest, "vestlang-pkg-0.1.0.tgz"), "");
      expect(packedManifest("/pkg", dest, spawn)).toEqual(manifest);
    });
  });
});
