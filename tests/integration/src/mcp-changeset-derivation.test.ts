// The guard watches whatever the mcp-server actually bundles, derived — never a
// frozen list. These pin the derivation two ways: against the real workspace (the
// closure and the guarded set it yields today) and over synthetic manifests (that
// the walk is genuinely dynamic and follows devDependency edges as well as
// dependency edges).
import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bundledClosure,
  graphFromManifests,
  guardedPackages,
  importSeeds,
  workspaceGraph,
  type ManifestFacts,
  type WorkspaceGraph,
} from "../../../scripts/check-mcp-changeset.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// The engine packages tsdown inlines into the published mcp-server bundle.
const BUNDLED_ENGINE = [
  "core",
  "dsl",
  "evaluator",
  "inferrer",
  "linter",
  "normalizer",
  "pipeline",
  "primitives",
  "recover",
  "render",
  "types",
  "utils",
  "walk",
].map((name) => `@vestlang/${name}`);

describe("derivation over the real workspace", () => {
  it("closes the mcp-server import seed onto exactly the bundled engine packages", () => {
    const closure = bundledClosure(
      workspaceGraph(repoRoot),
      importSeeds(repoRoot),
    );
    expect(new Set(closure)).toEqual(new Set(BUNDLED_ENGINE));
  });

  it("guards the bundled engine plus mcp-server, and never the umbrella", () => {
    const guarded = new Set(guardedPackages(repoRoot).map((pkg) => pkg.name));
    expect(guarded).toEqual(
      new Set([...BUNDLED_ENGINE, "@vestlang/mcp-server"]),
    );
    expect(guarded.has("@vestlang/vestlang")).toBe(false);
  });
});

describe("derivation is dynamic", () => {
  it("grows the closure when a seeded package gains a dep edge", () => {
    const without = graphFromManifests([
      { name: "@vestlang/a", dir: "packages/a" },
      { name: "@vestlang/b", dir: "packages/b" },
    ]);
    expect(new Set(bundledClosure(without, ["@vestlang/a"]))).toEqual(
      new Set(["@vestlang/a"]),
    );

    const facts: ManifestFacts[] = [
      { name: "@vestlang/a", dir: "packages/a", dependencies: ["@vestlang/b"] },
      { name: "@vestlang/b", dir: "packages/b" },
    ];
    const withEdge: WorkspaceGraph = graphFromManifests(facts);
    expect(new Set(bundledClosure(withEdge, ["@vestlang/a"]))).toEqual(
      new Set(["@vestlang/a", "@vestlang/b"]),
    );
  });

  it("shrinks the closure when the edge is removed", () => {
    const withEdge = graphFromManifests([
      { name: "@vestlang/a", dir: "packages/a", dependencies: ["@vestlang/b"] },
      { name: "@vestlang/b", dir: "packages/b" },
    ]);
    expect(bundledClosure(withEdge, ["@vestlang/a"])).toContain("@vestlang/b");

    const without = graphFromManifests([
      { name: "@vestlang/a", dir: "packages/a" },
      { name: "@vestlang/b", dir: "packages/b" },
    ]);
    expect(bundledClosure(without, ["@vestlang/a"])).not.toContain(
      "@vestlang/b",
    );
  });

  it("follows a devDependency-only edge into the closure", () => {
    // b is reachable from a solely through devDependencies — the inline edge a
    // future engine package could hide behind. Fold devDeps or miss it.
    const graph = graphFromManifests([
      {
        name: "@vestlang/a",
        dir: "packages/a",
        devDependencies: ["@vestlang/b"],
      },
      { name: "@vestlang/b", dir: "packages/b" },
    ]);
    expect(new Set(bundledClosure(graph, ["@vestlang/a"]))).toEqual(
      new Set(["@vestlang/a", "@vestlang/b"]),
    );
  });

  it("excludes a package nothing bundled depends on", () => {
    const graph = graphFromManifests([
      { name: "@vestlang/a", dir: "packages/a", dependencies: ["@vestlang/b"] },
      { name: "@vestlang/b", dir: "packages/b" },
      { name: "@vestlang/orphan", dir: "packages/orphan" },
    ]);
    expect(bundledClosure(graph, ["@vestlang/a"])).not.toContain(
      "@vestlang/orphan",
    );
  });
});
