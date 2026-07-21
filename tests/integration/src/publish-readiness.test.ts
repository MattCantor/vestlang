// Guards the release configuration itself. The pack-based artifact guard packs
// with pnpm, so it is blind to a regression that swaps the *publish command* back
// to workspace-unaware `npm publish`; these tests fence that directly, and pin the
// npm-facing metadata every published package needs on its landing page.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  publishablePackages,
  type Manifest,
} from "../../../scripts/check-published-artifacts.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Read off the manifests rather than listed here: whatever set of packages is
// publishable is the set the release has to cover, and a package that starts
// publishing should fail these until its step and its metadata exist.
const publishable = publishablePackages(repoRoot).map((pkg) => ({
  ...pkg,
  path: relative(repoRoot, pkg.dir),
}));

describe("release workflow publishes with pnpm", () => {
  const workflow = readFileSync(
    join(repoRoot, ".github/workflows/release.yml"),
    "utf8",
  );
  // \bnpm — a word boundary before `npm` — deliberately does not fire inside
  // `pnpm`, so this counts only standalone npm commands.
  const runCommands = workflow
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"));

  it("gives every publishable package a step, with public access", () => {
    const publishes = runCommands.filter((l) => /\bpnpm\s+publish\b/.test(l));
    expect(publishes).toHaveLength(publishable.length);
    for (const cmd of publishes) {
      expect(cmd).toContain("--access public");
    }
  });

  it("points each step at its package directory", () => {
    for (const pkg of publishable) {
      expect(runCommands, pkg.name).toContain(`working-directory: ${pkg.path}`);
    }
  });

  it("re-runs itself when any publishable manifest changes", () => {
    for (const pkg of publishable) {
      expect(runCommands, pkg.name).toContain(`- "${pkg.path}/package.json"`);
    }
  });

  it("disables git checks via the setting, never the CLI flag npm rejects", () => {
    // pnpm forwards its publish argv verbatim to the spawned `npm publish`
    // (only --publish-branch is stripped), and current npm hard-errors on the
    // unknown --git-checks flag. The env-var setting is the channel pnpm reads
    // and npm merely warns about — this broke the 0.1.1 publish once already.
    // Scan the comment-stripped lines: the workflow's own comments are allowed
    // to name the forbidden flag while explaining why it is forbidden.
    for (const line of runCommands) {
      expect(line).not.toContain("--no-git-checks");
    }
    expect(
      runCommands.filter((l) => /npm_config_git_checks:\s*"false"/.test(l)),
    ).toHaveLength(publishable.length);
  });

  it("never runs npm publish (comments may still mention it)", () => {
    const npmPublishes = runCommands.filter((l) => /\bnpm\s+publish\b/.test(l));
    expect(npmPublishes).toEqual([]);
  });

  it("keeps the npm view idempotence guard around every publish step", () => {
    expect(workflow.match(/\bnpm\s+view\b/g) ?? []).toHaveLength(
      publishable.length,
    );
  });
});

describe("version-pr workflow versions but never publishes", () => {
  const workflow = readFileSync(
    join(repoRoot, ".github/workflows/version-pr.yml"),
    "utf8",
  );
  const lines = workflow
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"));

  it("runs changesets/action with pnpm-driven versioning", () => {
    expect(lines.some((l) => l.startsWith("uses: changesets/action"))).toBe(
      true,
    );
    expect(lines).toContain("version: pnpm changeset version");
  });

  it("carries no publish input — Release owns publishing (Trusted Publishing)", () => {
    // A `publish:` input would create a second, tokenless publish path that
    // bypasses the Release workflow npm's trusted publisher is pinned to.
    expect(lines.some((l) => l.startsWith("publish:"))).toBe(false);
  });
});

// The guard only models the dependency fields; an npm landing page needs more.
interface PublishedManifest extends Manifest {
  license?: string;
  description?: string;
  repository?: { url?: string; directory?: string };
  bugs?: { url?: string };
  homepage?: string;
  keywords?: string[];
  engines?: { node?: string };
  files?: string[];
  publishConfig?: { registry?: string; access?: string };
}

describe.each(publishable)("$name npm metadata", (pkg) => {
  const manifest = pkg.manifest as PublishedManifest;

  it("carries the fields an npm page and a direct consumer need", () => {
    expect(manifest.license).toBeTruthy();
    expect(manifest.description).toBeTruthy();
    expect(manifest.repository?.url).toBeTruthy();
    expect(manifest.repository?.directory).toBe(pkg.path);
    expect(manifest.homepage).toBeTruthy();
    expect(manifest.bugs?.url).toBeTruthy();
    expect(manifest.keywords?.length).toBeGreaterThan(0);
    expect(manifest.engines?.node).toBeTruthy();
  });

  it("publishes publicly to the npm registry", () => {
    expect(manifest.publishConfig?.registry).toBe("https://registry.npmjs.org");
    expect(manifest.publishConfig?.access).toBe("public");
  });

  it("lists README and LICENSE in files, and both exist on disk", () => {
    expect(manifest.files).toContain("README.md");
    expect(manifest.files).toContain("LICENSE");
    expect(existsSync(join(pkg.dir, "README.md"))).toBe(true);
    expect(existsSync(join(pkg.dir, "LICENSE"))).toBe(true);
  });
});
