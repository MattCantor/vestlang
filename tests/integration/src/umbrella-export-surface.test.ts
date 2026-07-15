// Guards the shipped public surface of `@vestlang/vestlang` against the *built*
// barrel — the exact artifact consumers import. The value half lives here (a
// runtime test sees only values); the erased type half is locked separately in
// umbrella-type-surface.types.test.ts under `pnpm typecheck`. Sound only after a
// build, which is how CI runs (build before test).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as umbrella from "@vestlang/vestlang";

// The curated value exports. `core` is a namespace object; the rest are functions.
const EXPECTED_FUNCTIONS = [
  "parse",
  "normalizeProgram",
  "presentSchedule",
  "evaluateProgramWithRecovery",
  "lintProgram",
  "lintText",
  "stringify",
  "stringifyProgram",
  "stringifyStatement",
  "inferSchedule",
] as const;

describe("umbrella export surface", () => {
  it("exposes every curated value export", () => {
    for (const name of EXPECTED_FUNCTIONS) {
      expect(typeof umbrella[name], name).toBe("function");
    }
  });

  it("re-exports the core compiler as a namespace", () => {
    expect(typeof umbrella.core).toBe("object");
    expect(typeof umbrella.core.compile).toBe("function");
  });

  it("no longer exposes a primitives namespace", () => {
    expect("primitives" in umbrella).toBe(false);
  });
});

// The umbrella ships @vestlang/core as a real npm dependency — the one workspace
// package deliberately NOT bundled in, so it installs once and is shared with
// other consumers (OCF-Tools). A runtime import can't tell inlined from external,
// so this reads the built artifacts textually. If a bundler change ever inlined
// core, its import specifier would vanish from both files.
describe("core ships as a real external dependency of the umbrella", () => {
  const dist = (file: string): string =>
    readFileSync(
      fileURLToPath(
        new URL(`../../../packages/vestlang/dist/${file}`, import.meta.url),
      ),
      "utf8",
    );

  it("the built declarations import @vestlang/core", () => {
    expect(dist("index.d.ts")).toMatch(/from ["']@vestlang\/core["']/);
  });

  it("the built JS imports @vestlang/core and bundles every other @vestlang package", () => {
    const specifiers = new Set(
      [...dist("index.js").matchAll(/from\s*["'](@vestlang\/[^"']+)["']/g)].map(
        (m) => m[1],
      ),
    );
    expect(specifiers).toEqual(new Set(["@vestlang/core"]));
  });
});
