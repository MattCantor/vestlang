// Exercises the guard's judgement and its I/O wiring: the pure violation finder
// against synthesized change sets, the frontmatter parser against real changeset
// text, and the CLI core driven through its injectable git seam with canned diff
// output — so the base-handling, the stdout→file parse, and the changeset read all
// run for real, with no live git anywhere in this suite (the Release workflow runs
// it under a shallow checkout).
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BaseRefError,
  findChangesetGuardViolations,
  MCP_SERVER,
  parseChangesetNames,
  runGuard,
  type GuardedPackage,
  type SpawnLike,
} from "../../../scripts/check-mcp-changeset.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const GUARDED: GuardedPackage[] = [
  { name: "@vestlang/primitives", dir: "packages/primitives" },
  { name: "@vestlang/render", dir: "packages/render" },
  { name: MCP_SERVER, dir: "apps/mcp-server" },
];

describe("findChangesetGuardViolations", () => {
  it("flags a guarded engine src change with no mcp-server changeset", () => {
    const violations = findChangesetGuardViolations({
      changedFiles: ["packages/primitives/src/allocate.ts"],
      guarded: GUARDED,
      changesetNames: new Set(),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].package).toBe("@vestlang/primitives");
  });

  it("flags mcp-server's own src change with no mcp-server changeset", () => {
    const violations = findChangesetGuardViolations({
      changedFiles: ["apps/mcp-server/src/index.ts"],
      guarded: GUARDED,
      changesetNames: new Set(),
    });
    expect(violations.map((v) => v.package)).toEqual([MCP_SERVER]);
  });

  it("still flags when a changeset names only other packages", () => {
    const violations = findChangesetGuardViolations({
      changedFiles: ["packages/primitives/src/allocate.ts"],
      guarded: GUARDED,
      changesetNames: new Set(["@vestlang/vestlang", "@vestlang/core"]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].package).toBe("@vestlang/primitives");
  });

  it("passes once a changeset names mcp-server", () => {
    const violations = findChangesetGuardViolations({
      changedFiles: [
        "packages/primitives/src/allocate.ts",
        "apps/mcp-server/src/index.ts",
      ],
      guarded: GUARDED,
      changesetNames: new Set([MCP_SERVER]),
    });
    expect(violations).toEqual([]);
  });

  const inertChanges: [string, string[]][] = [
    [
      "a guarded package's non-src files",
      [
        "packages/primitives/README.md",
        "packages/primitives/package.json",
        "packages/primitives/tests/allocate.test.ts",
      ],
    ],
    [
      "a non-guarded package's src",
      [
        "packages/prettier-plugin-vestlang/src/index.ts",
        "apps/cli/src/main.ts",
        "packages/vestlang/src/index.ts",
      ],
    ],
    [
      "files outside any package",
      ["scripts/check-mcp-changeset.mts", ".github/workflows/ci.yml"],
    ],
    [
      "a dir whose prefix collides with a guarded package",
      ["packages/render-x/src/index.ts"],
    ],
  ];

  it.each(inertChanges)("passes for %s", (_label, changedFiles) => {
    expect(
      findChangesetGuardViolations({
        changedFiles,
        guarded: GUARDED,
        changesetNames: new Set(),
      }),
    ).toEqual([]);
  });
});

describe("parseChangesetNames", () => {
  it("reads a frontmatter name at any bump type", () => {
    expect(
      parseChangesetNames(`---\n"${MCP_SERVER}": patch\n---\n\nA fix.\n`),
    ).toEqual([MCP_SERVER]);
    expect(parseChangesetNames(`---\n"${MCP_SERVER}": major\n---\n`)).toEqual([
      MCP_SERVER,
    ]);
  });

  it("reads mcp-server alongside other names", () => {
    expect(
      parseChangesetNames(
        `---\n"@vestlang/core": minor\n"${MCP_SERVER}": patch\n---\n`,
      ),
    ).toEqual(["@vestlang/core", MCP_SERVER]);
  });

  it("reads only the other names when mcp-server is absent", () => {
    expect(
      parseChangesetNames(`---\n"@vestlang/vestlang": minor\n---\n`),
    ).toEqual(["@vestlang/vestlang"]);
  });

  it("ignores a mention in the prose body", () => {
    const contents = `---\n"@vestlang/vestlang": minor\n---\n\nThis also refreshes ${MCP_SERVER} downstream.\n`;
    expect(parseChangesetNames(contents)).toEqual(["@vestlang/vestlang"]);
  });

  it("yields nothing for a file with no frontmatter", () => {
    expect(parseChangesetNames(`# Changesets\n\nHello and welcome!\n`)).toEqual(
      [],
    );
    expect(parseChangesetNames("")).toEqual([]);
  });
});

// A git runner that answers rev-parse with a fixed sha and diff with a canned
// file list — the shape the injectable seam accepts, so the CLI's real base and
// parse code runs.
function cannedGit(diffStdout: string): SpawnLike {
  return (_command, args) =>
    args[0] === "diff"
      ? { status: 0, stdout: diffStdout, stderr: "" }
      : { status: 0, stdout: "cafef00d\n", stderr: "" };
}

describe("runGuard through the real seams", () => {
  function withChangesetDir(run: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), "mcp-changeset-"));
    try {
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("fails, naming the package, when guarded src changed and no changeset names mcp-server", () => {
    withChangesetDir((changesetDir) => {
      writeFileSync(
        join(changesetDir, "feature.md"),
        `---\n"@vestlang/vestlang": minor\n---\n\nAn umbrella feature.\n`,
      );
      // A frontmatter-less file must be tolerated, not read as a name.
      writeFileSync(
        join(changesetDir, "README.md"),
        `# Changesets\n\nHello.\n`,
      );

      const outcome = runGuard({
        repoRoot,
        changesetDir,
        gitCwd: repoRoot,
        spawn: cannedGit("packages/primitives/src/allocate.ts\n"),
        env: {},
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.message).toContain("@vestlang/primitives");
    });
  });

  it("passes when a changeset in the directory names mcp-server", () => {
    withChangesetDir((changesetDir) => {
      writeFileSync(
        join(changesetDir, "publish.md"),
        `---\n"${MCP_SERVER}": minor\n---\n\nPublish the server.\n`,
      );
      const outcome = runGuard({
        repoRoot,
        changesetDir,
        gitCwd: repoRoot,
        spawn: cannedGit("packages/primitives/src/allocate.ts\n"),
        env: {},
      });
      expect(outcome.ok).toBe(true);
    });
  });

  it("fails distinctly when the base ref can't be resolved", () => {
    const failingRevParse: SpawnLike = (_command, args) =>
      args[0] === "rev-parse"
        ? { status: 1, stdout: "", stderr: "fatal: bad revision" }
        : { status: 0, stdout: "", stderr: "" };
    const call = () =>
      runGuard({
        repoRoot,
        changesetDir: join(repoRoot, ".changeset"),
        gitCwd: repoRoot,
        spawn: failingRevParse,
        env: {},
      });
    expect(call).toThrow(BaseRefError);
    expect(call).toThrow(/cannot resolve base ref/);
  });
});

describe("ci.yml wires the guard into the required check job", () => {
  const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  // Slice the `check:` job block — from its header to the next top-level job (a
  // 2-space-indented key) or EOF — so these assertions are scoped to that job even
  // if a second job is added later. No YAML parser: the block is matched as text.
  const lines = ci.split("\n");
  const start = lines.findIndex((line) => /^ {2}check:\s*$/.test(line));
  const afterStart = lines.findIndex(
    (line, i) => i > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line),
  );
  const checkJob = lines
    .slice(start, afterStart === -1 ? lines.length : afterStart)
    .join("\n");

  it("checks out full history so the base ref is diffable", () => {
    expect(checkJob).toContain("actions/checkout");
    expect(checkJob).toContain("fetch-depth: 0");
  });

  it("runs the guard, gated to pull_request events", () => {
    expect(checkJob).toContain("pnpm check:mcp-changeset");
    expect(checkJob).toContain(
      "if: ${{ github.event_name == 'pull_request' }}",
    );
  });
});
