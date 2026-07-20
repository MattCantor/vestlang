// Guards the `@vestlang/vestlang/authoring` subpath against the *built* artifact
// — the exact files a consumer resolves. Sound only after a build, which is how
// CI runs it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as authoring from "@vestlang/vestlang/authoring";

const packageDir = fileURLToPath(
  new URL("../../../packages/vestlang/", import.meta.url),
);

const manifest = JSON.parse(
  readFileSync(join(packageDir, "package.json"), "utf8"),
) as {
  exports: Record<string, { types: string; import: string }>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("the authoring subpath", () => {
  it("points at declaration and JS targets that exist after a build", () => {
    const entry = manifest.exports["./authoring"];
    expect(entry).toBeDefined();
    for (const target of [entry.types, entry.import]) {
      expect(existsSync(join(packageDir, target)), target).toBe(true);
    }
  });

  it("exposes the authoring functions", () => {
    for (const name of [
      "validateVestlang",
      "formatAuthoringFeedback",
      "authorVestlang",
    ] as const) {
      expect(typeof authoring[name], name).toBe("function");
    }
  });

  it("exposes the prompt and the sentinel as non-empty strings", () => {
    for (const name of [
      "VESTLANG_AUTHORING_PROMPT",
      "INDETERMINATE_SENTINEL",
    ] as const) {
      expect(typeof authoring[name], name).toBe("string");
      expect(authoring[name].length, name).toBeGreaterThan(0);
    }
  });
});

// The published umbrella bundles every private @vestlang package and keeps only
// @vestlang/core external. Adding a second entry lets the bundler split shared
// modules into hash-named chunks, so a leak can hide outside the entry files —
// hence the walk over the whole of dist rather than a lookup of two filenames.
describe("the authoring entry reaches no private workspace package", () => {
  const builtFiles = (): string[] => {
    const dist = join(packageDir, "dist");
    return readdirSync(dist, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && /\.(?:js|d\.ts)$/.test(e.name))
      .map((e) => join(e.parentPath, e.name));
  };

  // Every syntactic form a specifier hides in, including the inline
  // `import("…")` a declaration bundle emits — a from-clause-only scan waves
  // exactly the shape a resolve failure takes straight through.
  const REACHES =
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'](@vestlang\/[^"']+)["']/g;

  it("names only @vestlang/core across every emitted file", () => {
    const files = builtFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const specifiers = new Set(
        [...readFileSync(file, "utf8").matchAll(REACHES)].map((m) => m[1]),
      );
      for (const specifier of specifiers) {
        expect(specifier, file).toBe("@vestlang/core");
      }
    }
  });
});

describe("the authoring API carries no transport dependency", () => {
  it("leaves the umbrella's runtime dependencies untouched", () => {
    expect(new Set(Object.keys(manifest.dependencies))).toEqual(
      new Set(["@vestlang/core", "zod"]),
    );
  });

  it("pulls in no LLM SDK to develop against", () => {
    const devDeps = Object.keys(manifest.devDependencies);
    for (const sdk of [
      "anthropic",
      "@anthropic-ai",
      "openai",
      "ai",
      "@ai-sdk",
      "@google",
      "cohere-ai",
    ]) {
      expect(devDeps.some((d) => d === sdk || d.startsWith(`${sdk}/`))).toBe(
        false,
      );
    }
  });
});
