// Guards the release invariant that @vestlang/mcp-server can't state itself: it
// bundles the engine packages into its published dist but declares them as
// *devDependencies*, and changesets never cascades a version bump across a
// devDependency edge. So a change to a bundled engine package (or to mcp-server's
// own src) alters the bytes `npx @vestlang/mcp-server` ships yet bumps nothing —
// the published server serves a stale engine until some changeset literally names
// @vestlang/mcp-server. This guard fails a PR that touches a bundled package's
// `src/**` when no pending changeset names mcp-server.
//
// The core is pure and fixture-driven (`bundledClosure`,
// `findChangesetGuardViolations`, `parseChangesetNames`). The live-tree CLI at the
// bottom builds the workspace graph, scans mcp-server's imports for the bundle
// seed, reads `.changeset/`, and diffs against the PR base — the last through an
// injectable spawn seam so the git path is unit-testable without a live repo.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectSpecifiers,
  packageNameOf,
  readManifest,
  workspacePackageDirs,
  type SpawnLike,
} from "./lib/workspace.mts";

export const MCP_SERVER = "@vestlang/mcp-server";

// --- pure core -------------------------------------------------------------

/** A workspace node: its repo-relative POSIX dir and its `@vestlang/*` deps+devDeps. */
export type WorkspaceGraph = Record<
  string,
  { dir: string; workspaceDeps: readonly string[] }
>;

/**
 * Every workspace package reachable from `seeds` by following `workspaceDeps`,
 * seeds included. `seeds` are the packages mcp-server's src imports; the closure
 * is everything tsdown then inlines into its bundle. A name with no graph node
 * (e.g. an external seed) still counts as reached but contributes no edges.
 */
export function bundledClosure(
  graph: WorkspaceGraph,
  seeds: readonly string[],
): string[] {
  const reached = new Set<string>();
  const stack = [...seeds];
  while (stack.length > 0) {
    const name = stack.pop();
    if (name === undefined || reached.has(name)) continue;
    reached.add(name);
    for (const dep of graph[name]?.workspaceDeps ?? []) {
      if (!reached.has(dep)) stack.push(dep);
    }
  }
  return [...reached];
}

/** The dependency facts a manifest contributes to the graph. */
export interface ManifestFacts {
  name: string;
  dir: string;
  dependencies?: readonly string[];
  devDependencies?: readonly string[];
}

// deps and devDeps collapse into one edge set: a bundled package can inline an
// engine package through either field (the noExternal path), and the inlined
// bytes ship regardless of which one named it. Restricting to `@vestlang/*` drops
// third-party deps, which aren't bundled.
export function graphFromManifests(
  manifests: readonly ManifestFacts[],
): WorkspaceGraph {
  const graph: WorkspaceGraph = {};
  for (const m of manifests) {
    const workspaceDeps = [
      ...(m.dependencies ?? []),
      ...(m.devDependencies ?? []),
    ].filter((d) => d.startsWith("@vestlang/"));
    graph[m.name] = { dir: m.dir, workspaceDeps };
  }
  return graph;
}

/** A package the guard watches, joined to its repo-relative POSIX dir. */
export interface GuardedPackage {
  name: string;
  dir: string;
}

export interface GuardViolation {
  package: string;
  message: string;
}

export interface ChangesetGuardInput {
  changedFiles: readonly string[];
  guarded: readonly GuardedPackage[];
  changesetNames: ReadonlySet<string>;
}

function toPosixRelative(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * One violation per guarded package whose `src/**` a changed file touches, when
 * no changeset names mcp-server. A present mcp-server changeset freshens the whole
 * next release, so it clears every package at once — directory-wide presence is
 * the release-level invariant, not a per-package one. The `${dir}/src/` prefix is
 * matched with its trailing slash, so the boundary is a whole path segment:
 * `packages/render` never matches `packages/render-x/src/…`.
 */
export function findChangesetGuardViolations({
  changedFiles,
  guarded,
  changesetNames,
}: ChangesetGuardInput): GuardViolation[] {
  if (changesetNames.has(MCP_SERVER)) return [];
  const touched = changedFiles.map(toPosixRelative);
  const violations: GuardViolation[] = [];
  for (const { name, dir } of guarded) {
    const srcPrefix = `${toPosixRelative(dir)}/src/`;
    if (touched.some((file) => file.startsWith(srcPrefix))) {
      violations.push({
        package: name,
        message: `${name} has a src change but no changeset names ${MCP_SERVER} — the published server would ship a stale bundle`,
      });
    }
  }
  return violations;
}

// A changeset's frontmatter is a `---`-fenced block of `"pkg": bump` lines at the
// top of the file; its prose body may name packages too, but only the frontmatter
// triggers a release. Read the first fenced block and nothing else, so a body
// mention of mcp-server never counts and a plain markdown file (`.changeset/README.md`)
// yields nothing.
export function parseChangesetNames(fileContents: string): string[] {
  const lines = fileContents.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length || lines[i].trim() !== "---") return [];
  const names: string[] = [];
  for (i += 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    const match = /^\s*["']([^"']+)["']\s*:/.exec(lines[i]);
    if (match) names.push(match[1]);
  }
  return names;
}

// --- live-tree CLI ---------------------------------------------------------

/** Build the workspace graph from every package.json under the workspace globs. */
export function workspaceGraph(repoRoot: string): WorkspaceGraph {
  const facts: ManifestFacts[] = [];
  for (const abs of workspacePackageDirs(repoRoot)) {
    const manifest = readManifest(join(abs, "package.json"));
    if (!manifest.name) continue;
    facts.push({
      name: manifest.name,
      dir: relative(repoRoot, abs).split(sep).join("/"),
      dependencies: Object.keys(manifest.dependencies ?? {}),
      devDependencies: Object.keys(manifest.devDependencies ?? {}),
    });
  }
  return graphFromManifests(facts);
}

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/;

/**
 * The `@vestlang/*` packages mcp-server's src imports — the true bundle entry.
 * Scanning imports (not the manifest) is what naturally excludes the umbrella:
 * mcp-server devDepends on it for build scripts, but src never imports it. Only
 * the `@vestlang/*` specifiers matter here; the shared scan returns them all and
 * this narrows.
 */
export function importSeeds(repoRoot: string): string[] {
  const srcDir = join(repoRoot, "apps", "mcp-server", "src");
  const seeds = new Set<string>();
  if (!existsSync(srcDir)) return [];
  for (const entry of readdirSync(srcDir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !SOURCE_FILE.test(entry.name)) continue;
    const content = readFileSync(join(entry.parentPath, entry.name), "utf8");
    for (const specifier of collectSpecifiers(content)) {
      if (specifier.startsWith("@vestlang/"))
        seeds.add(packageNameOf(specifier));
    }
  }
  return [...seeds];
}

/** The bundle closure plus mcp-server itself, each joined to its dir. */
export function guardedPackages(repoRoot: string): GuardedPackage[] {
  const graph = workspaceGraph(repoRoot);
  const names = new Set([
    ...bundledClosure(graph, importSeeds(repoRoot)),
    MCP_SERVER,
  ]);
  return [...names].map((name) => {
    const node = graph[name];
    if (!node)
      throw new Error(`guarded package ${name} is not in the workspace`);
    return { name, dir: node.dir };
  });
}

function readChangesetNames(changesetDir: string): Set<string> {
  const names = new Set<string>();
  if (!existsSync(changesetDir)) return names;
  for (const file of readdirSync(changesetDir)) {
    if (!file.endsWith(".md")) continue;
    for (const name of parseChangesetNames(
      readFileSync(join(changesetDir, file), "utf8"),
    )) {
      names.add(name);
    }
  }
  return names;
}

// Raised when the base ref can't be resolved. Distinct so the CLI fails loudly
// rather than treating an unresolved base as an empty diff, which would pass
// silently.
export class BaseRefError extends Error {}

// Resolution order: an explicit --base / MCP_GUARD_BASE, else the PR target
// (origin/$GITHUB_BASE_REF on pull_request events), else origin/main.
function pickBaseRef(explicit: string | undefined, env: EnvLike): string {
  const chosen = explicit ?? env.MCP_GUARD_BASE;
  if (chosen) return chosen;
  if (env.GITHUB_BASE_REF) return `origin/${env.GITHUB_BASE_REF}`;
  return "origin/main";
}

// Three-dot diff: the files the branch changed since its merge-base with the
// base, so unrelated movement on the base doesn't register.
function diffChangedFiles(
  base: string,
  cwd: string,
  spawn: SpawnLike,
): string[] {
  const resolved = spawn(
    "git",
    ["rev-parse", "--verify", "--quiet", `${base}^{commit}`],
    {
      cwd,
      encoding: "utf8",
    },
  );
  if (resolved.status !== 0) {
    throw new BaseRefError(
      `cannot resolve base ref "${base}". Fetch it first ` +
        `(\`git fetch origin <branch>\`) or pass --base <ref>.`,
    );
  }
  const diff = spawn("git", ["diff", "--name-only", `${base}...HEAD`], {
    cwd,
    encoding: "utf8",
  });
  if (diff.status !== 0) {
    throw new Error(
      `\`git diff ${base}...HEAD\` failed (exit ${diff.status ?? "?"}).\n${diff.stderr}`,
    );
  }
  return diff.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

type EnvLike = Record<string, string | undefined>;

export interface GuardOutcome {
  ok: boolean;
  violations: GuardViolation[];
  message: string;
}

const PASS_MESSAGE = `No bundled engine src changed without a ${MCP_SERVER} changeset.`;

function formatViolations(violations: GuardViolation[]): string {
  return [
    `Bundled engine src changed with no ${MCP_SERVER} changeset:`,
    "",
    ...violations.map((v) => `  [${v.package}] ${v.message}`),
    "",
    `Add a changeset naming ${MCP_SERVER} (any bump) so \`npx ${MCP_SERVER}\` ` +
      `ships the change. Run \`pnpm changeset\`.`,
  ].join("\n");
}

/** The CLI's core: resolve the base, diff, read changesets, judge. */
export function runGuard(opts: {
  repoRoot: string;
  changesetDir: string;
  gitCwd: string;
  spawn: SpawnLike;
  baseArg?: string;
  env: EnvLike;
}): GuardOutcome {
  const base = pickBaseRef(opts.baseArg, opts.env);
  const changedFiles = diffChangedFiles(base, opts.gitCwd, opts.spawn);
  const violations = findChangesetGuardViolations({
    changedFiles,
    guarded: guardedPackages(opts.repoRoot),
    changesetNames: readChangesetNames(opts.changesetDir),
  });
  return {
    ok: violations.length === 0,
    violations,
    message:
      violations.length === 0 ? PASS_MESSAGE : formatViolations(violations),
  };
}

function baseArgOf(argv: readonly string[]): string | undefined {
  const flag = argv.indexOf("--base");
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  const inline = argv.find((a) => a.startsWith("--base="));
  return inline?.slice("--base=".length);
}

/**
 * Run the guard and return a process exit code: 0 when clean, 1 on a violation
 * or an unresolvable base. Console output goes through injectable `log`/`logError`
 * (defaulting to the console) so a caller can drive the exit-code mapping without
 * a live child process.
 */
export function run(opts: {
  repoRoot: string;
  changesetDir: string;
  gitCwd: string;
  spawn: SpawnLike;
  argv: readonly string[];
  env: EnvLike;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}): number {
  const log = opts.log ?? console.log;
  const logError = opts.logError ?? console.error;
  try {
    const outcome = runGuard({
      repoRoot: opts.repoRoot,
      changesetDir: opts.changesetDir,
      gitCwd: opts.gitCwd,
      spawn: opts.spawn,
      baseArg: baseArgOf(opts.argv),
      env: opts.env,
    });
    if (!outcome.ok) {
      logError(outcome.message);
      return 1;
    }
    log(outcome.message);
    return 0;
  } catch (err) {
    if (err instanceof BaseRefError) {
      logError(err.message);
      return 1;
    }
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  process.exit(
    run({
      repoRoot,
      changesetDir: join(repoRoot, ".changeset"),
      gitCwd: repoRoot,
      spawn: spawnSync,
      argv: process.argv.slice(2),
      env: process.env,
    }),
  );
}
