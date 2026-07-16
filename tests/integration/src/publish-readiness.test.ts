// Guards the release configuration itself. The pack-based artifact guard packs
// with pnpm, so it is blind to a regression that swaps the *publish command* back
// to workspace-unaware `npm publish`; these tests fence that directly, and pin the
// npm-facing metadata @vestlang/core needs now that OCF-Tools installs it.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

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

  it("runs pnpm publish for both packages with public access", () => {
    const publishes = runCommands.filter((l) => /\bpnpm\s+publish\b/.test(l));
    expect(publishes).toHaveLength(2);
    for (const cmd of publishes) {
      expect(cmd).toContain("--access public");
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
    ).toHaveLength(2);
  });

  it("never runs npm publish (comments may still mention it)", () => {
    const npmPublishes = runCommands.filter((l) => /\bnpm\s+publish\b/.test(l));
    expect(npmPublishes).toEqual([]);
  });

  it("keeps the npm view idempotence guard around both publish steps", () => {
    expect(workflow.match(/\bnpm\s+view\b/g) ?? []).toHaveLength(2);
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

interface CoreManifest {
  license?: string;
  repository?: { url?: string; directory?: string };
  bugs?: { url?: string };
  homepage?: string;
  keywords?: string[];
  engines?: { node?: string };
  files?: string[];
}

describe("@vestlang/core npm metadata", () => {
  const coreDir = join(repoRoot, "packages/core");
  const pkg = JSON.parse(
    readFileSync(join(coreDir, "package.json"), "utf8"),
  ) as CoreManifest;

  it("carries the fields an npm page and a direct consumer need", () => {
    expect(pkg.license).toBeTruthy();
    expect(pkg.repository?.url).toBeTruthy();
    expect(pkg.repository?.directory).toBe("packages/core");
    expect(pkg.homepage).toBeTruthy();
    expect(pkg.bugs?.url).toBeTruthy();
    expect(pkg.keywords?.length).toBeGreaterThan(0);
    expect(pkg.engines?.node).toBeTruthy();
  });

  it("lists README and LICENSE in files, and both exist on disk", () => {
    expect(pkg.files).toContain("README.md");
    expect(pkg.files).toContain("LICENSE");
    expect(existsSync(join(coreDir, "README.md"))).toBe(true);
    expect(existsSync(join(coreDir, "LICENSE"))).toBe(true);
  });
});
