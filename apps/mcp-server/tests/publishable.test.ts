// The server publishes to npm as a bin-only package that inlines the private
// @vestlang/* packages into its own bundle. This covers the manifest side of a
// working `npx @vestlang/mcp-server`: the right deps declared, the bin present
// with its shebang, no stray type output. That the bundle itself reaches for
// nothing beyond its two runtime deps is the publish guard's job
// (`pnpm check:artifacts`), which now runs over this package too — so it isn't
// re-checked, more weakly, here.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Manifest {
  private?: boolean;
  bin?: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const manifest = JSON.parse(
  readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"),
) as Manifest;

const DIST = join(PACKAGE_DIR, "dist");
const built = new Map<string, string>();
if (existsSync(DIST)) {
  for (const entry of readdirSync(DIST, { recursive: true }).map(String)) {
    if (/\.(?:js|cjs|mjs|d\.[cm]?ts)$/.test(entry)) {
      built.set(entry, readFileSync(join(DIST, entry), "utf8"));
    }
  }
}

describe("the published manifest", () => {
  it("is not marked private", () => {
    // Has to be asserted here rather than in the repo-wide release tests: those
    // derive their package set by filtering out private manifests, so a `private`
    // flag creeping back would delete this package's coverage instead of failing
    // it.
    expect(manifest.private).toBeUndefined();
  });

  it("asks npm only for the two external runtime deps", () => {
    const runtime = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ].sort();
    expect(runtime).toEqual(["@modelcontextprotocol/sdk", "zod"]);
  });

  it("still declares the workspace packages it bundles", () => {
    // Dropping them would be worse than cosmetic: pnpm's isolated node_modules
    // won't resolve an undeclared workspace package, and turbo needs the edge to
    // build the dist that tsdown reads.
    const dev = manifest.devDependencies ?? {};
    for (const name of [
      "@vestlang/core",
      "@vestlang/evaluator",
      "@vestlang/inferrer",
      "@vestlang/linter",
      "@vestlang/pipeline",
      "@vestlang/primitives",
      "@vestlang/render",
      "@vestlang/types",
      "@vestlang/utils",
    ]) {
      expect(dev[name], name).toBe("workspace:*");
    }
  });

  it("packs the built output, the resources, and the landing page", () => {
    // Naming them is the point: iterating whatever `files` happens to hold can
    // only catch an entry that points nowhere, never one that was dropped. Lose
    // "dist" and the bin target is absent from the tarball; lose "resources" and
    // every resource read fails on an installed copy.
    expect(manifest.files).toEqual(
      expect.arrayContaining(["dist", "resources", "README.md", "LICENSE"]),
    );
    for (const entry of manifest.files ?? []) {
      expect(existsSync(join(PACKAGE_DIR, entry)), entry).toBe(true);
    }
  });
});

describe("the built bundle", () => {
  it("keeps the shebang npx needs on the bin entry", () => {
    expect(manifest.bin?.["vestlang-mcp"]).toBe("dist/index.js");
    const entry = built.get("index.js");
    expect(
      entry,
      "dist/index.js is missing — build the package before running this",
    ).toBeDefined();
    expect(entry!.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("ships no declarations — nothing consumes this package's types", () => {
    expect([...built.keys()].filter((f) => /\.d\.[cm]?ts$/.test(f))).toEqual(
      [],
    );
  });
});
