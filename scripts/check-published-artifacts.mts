// Publish-readiness guard, two checks over every publishable package:
//   1. Self-containment — every module specifier its *built* output reaches for
//      (declarations and JS) resolves for a fresh `npm install`: a runtime dep, a
//      Node builtin, or — for relative specifiers — a file that actually exists in
//      the built output. A private workspace package never reaches npm, so a built
//      artifact still importing one is a broken publish; a relative specifier with
//      no file behind it is a bundler resolve failure that shipped (#542's
//      malformed d.ts carried a live `require("./external.cjs")` with no such
//      file in dist).
//   2. No surviving `workspace:` range in the *packed* manifest's resolved deps —
//      pnpm rewrites those to concrete versions at pack time, so a survivor means
//      the tarball would install with EUNSUPPORTEDPROTOCOL.
//
// Both are pure functions (`findViolations`, `findWorkspaceRangeViolations`) so
// they can be exercised against fixture inputs; the CLI at the bottom is the thin
// live-tree wrapper (it packs each package with pnpm to feed check 2).

import { isBuiltin } from "node:module";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// --- pure core -------------------------------------------------------------

/** One built file to scan. `path` is for reporting only. */
export interface BuiltArtifact {
  path: string;
  content: string;
}

/** Everything the scanner needs to judge one workspace package. */
export interface PackageScan {
  name: string;
  /** dependencies + peerDependencies + optionalDependencies, merged. */
  runtimeDeps: readonly string[];
  artifacts: readonly BuiltArtifact[];
}

export interface Violation {
  package: string;
  kind: "unresolved-specifier" | "private-runtime-dep" | "workspace-range";
  message: string;
}

/**
 * The dependency-bearing fields of a *packed* manifest — what a consumer's
 * install actually resolves. The live-tree `Manifest` below extends this, so
 * either form is accepted here.
 */
export interface PackedManifest {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const WORKSPACE_PROTOCOL = "workspace:";

// A consumer resolves these three fields; devDependencies are out of scope —
// nobody installs a dependency's devDeps, and a packed manifest legitimately
// keeps private-package versions there.
const RESOLVED_DEP_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * A published package must not carry a `workspace:` range in any field a
 * consumer resolves: pnpm rewrites those to concrete versions when it packs, so
 * a survivor means the tarball was built by a workspace-unaware tool (a plain
 * `npm publish`) and would install with EUNSUPPORTEDPROTOCOL. Runs against the
 * *packed* manifest — `workspace:*` in a package's source is correct pnpm usage.
 */
export function findWorkspaceRangeViolations(
  manifest: PackedManifest,
): Violation[] {
  const violations: Violation[] = [];
  const name = manifest.name ?? "<unnamed package>";
  for (const field of RESOLVED_DEP_FIELDS) {
    for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
      if (range.startsWith(WORKSPACE_PROTOCOL)) {
        violations.push({
          package: name,
          kind: "workspace-range",
          message: `${field} "${dep}" is still "${range}" — an unrewritten workspace range; pack with pnpm so it resolves to a concrete version`,
        });
      }
    }
  }
  return violations;
}

// A bare specifier is one that isn't relative and isn't the package's own name.
// Its *package name* is the specifier with any subpath stripped, so `zod/mini`
// checks against a `zod` dep and `@scope/pkg/sub` against `@scope/pkg`.
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return parts[0];
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

// The artifact extensions the guard scans — shared by the CLI's dist walk and the
// relative-specifier existence check (only paths of these shapes are judged, so a
// relative reach for e.g. a .json asset is never a false positive).
const BUILT_FILE = /\.(?:d\.ts|d\.cts|d\.mts|js|cjs|mjs)$/;

// A declaration file. Inside one, TypeScript resolves a relative JS specifier to
// its declaration sibling, so the existence check below accepts that sibling in
// place of a literal `.js`. `.d.ts` / `.d.cts` / `.d.mts` only — a plain
// `.ts`/`.mts` is source, not a declaration, and gets no such latitude.
const DECLARATION_FILE = /\.d\.(?:ts|cts|mts)$/;

// TypeScript rewrites a relative JS specifier to its declaration counterpart on
// resolve, keyed on the *referenced* extension (not the file it sits in), so a
// `.d.ts` reaching for `./x.mjs` lands on `x.d.mts`.
const DECLARATION_SIBLING_EXT: Record<string, string> = {
  ".js": ".d.ts",
  ".cjs": ".d.cts",
  ".mjs": ".d.mts",
};

// The declaration path a relative JS specifier resolves to inside a declaration
// file, or undefined when the specifier isn't one of the three JS shapes.
function declarationSiblingOf(specifier: string): string | undefined {
  for (const [js, dts] of Object.entries(DECLARATION_SIBLING_EXT)) {
    if (specifier.endsWith(js)) return specifier.slice(0, -js.length) + dts;
  }
  return undefined;
}

// Every syntactic form a specifier can hide in — including the inline
// `import("…")` type reference a resolve failure emits, which a from-clause-only
// scan would miss.
const SPECIFIER_PATTERNS: readonly RegExp[] = [
  /\bfrom\s*["']([^"']+)["']/g, // import/export … from '…'
  /\bimport\s*["']([^"']+)["']/g, // side-effect import '…'
  /\bimport\s*\(\s*["']([^"']+)["']/g, // import('…') / import("…").T
  /\brequire\s*\(\s*["']([^"']+)["']/g, // require('…'), import x = require('…')
];

const REFERENCE_TYPES_PATTERN =
  /\/\/\/\s*<reference\s+types\s*=\s*["']([^"']+)["']/g;

// A real specifier stays on this charset. Bundled JS (e.g. the generated peggy
// parser) carries string literals that end in a keyword like `from`, so a naive
// `from"…"` match can capture the gap between two adjacent literals — that debris
// contains whitespace, `;`, `=`, so this rejects it before it's mistaken for an
// import.
const SPECIFIER_SHAPE = /^[\w@./:~-]+$/;

function matchAll(content: string, pattern: RegExp): string[] {
  return [...content.matchAll(pattern)].map((m) => m[1]);
}

function collectSpecifiers(content: string): string[] {
  return SPECIFIER_PATTERNS.flatMap((p) => matchAll(content, p)).filter((s) =>
    SPECIFIER_SHAPE.test(s),
  );
}

/**
 * Given a package's manifest facts, its built artifacts, and the set of private
 * workspace package names, return every publish-blocking violation. Two classes:
 *  - a built specifier that resolves to neither a runtime dep nor a builtin, and
 *  - a runtime dep field that names a private workspace package (which can never
 *    satisfy the first check, so it's called out at the source).
 */
export function findViolations(
  pkg: PackageScan,
  privateWorkspaceNames: ReadonlySet<string>,
): Violation[] {
  const violations: Violation[] = [];
  const deps = new Set(pkg.runtimeDeps);

  for (const dep of pkg.runtimeDeps) {
    if (privateWorkspaceNames.has(dep)) {
      violations.push({
        package: pkg.name,
        kind: "private-runtime-dep",
        message: `runtime dep "${dep}" is a private workspace package — it never publishes to npm`,
      });
    }
  }

  const resolvable = (name: string): boolean => deps.has(name);
  const artifactPaths = new Set(pkg.artifacts.map((a) => a.path));

  for (const artifact of pkg.artifacts) {
    for (const specifier of collectSpecifiers(artifact.content)) {
      if (isRelative(specifier)) {
        // A relative specifier must land on a real built file. A dangling one is
        // a bundler resolve failure baked into the artifact — the #542 shape,
        // where the d.ts bundle carried `require("./external.cjs")` verbatim.
        // Only judge built-file shapes; extensionless or asset paths pass.
        if (!BUILT_FILE.test(specifier)) continue;
        const dir = dirname(artifact.path);
        if (artifactPaths.has(join(dir, specifier))) continue;
        // Inside a declaration file the literal `.js` need not exist: TypeScript
        // resolves it to the emitted declaration sibling (a shared `.d.ts` chunk
        // whose importers still spell it `.js`). A JS artifact gets no such
        // reprieve, so the check keeps its teeth there.
        if (DECLARATION_FILE.test(artifact.path)) {
          const sibling = declarationSiblingOf(specifier);
          if (sibling && artifactPaths.has(join(dir, sibling))) continue;
        }
        violations.push({
          package: pkg.name,
          kind: "unresolved-specifier",
          message: `${artifact.path} references "${specifier}", which does not exist in the built output`,
        });
        continue;
      }
      const name = packageNameOf(specifier);
      if (name === pkg.name) continue;
      if (isBuiltin(specifier) || isBuiltin(name)) continue;
      if (resolvable(name)) continue;
      violations.push({
        package: pkg.name,
        kind: "unresolved-specifier",
        message: `${artifact.path} imports "${specifier}" (→ "${name}"), which is not a runtime dependency`,
      });
    }

    for (const typesName of matchAll(
      artifact.content,
      REFERENCE_TYPES_PATTERN,
    )) {
      if (typesName === "node" || isBuiltin(typesName)) continue;
      if (resolvable(typesName) || resolvable(`@types/${typesName}`)) continue;
      violations.push({
        package: pkg.name,
        kind: "unresolved-specifier",
        message: `${artifact.path} references types "${typesName}", which is not a runtime dependency`,
      });
    }
  }

  return violations;
}

// --- live-tree CLI ---------------------------------------------------------

export interface Manifest extends PackedManifest {
  private?: boolean;
}

function readManifest(file: string): Manifest {
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

function runtimeDepsOf(manifest: Manifest): string[] {
  return RESOLVED_DEP_FIELDS.flatMap((f) => Object.keys(manifest[f] ?? {}));
}

// pnpm-workspace.yaml holds the authoritative globs (the root package.json's
// `workspaces` omits tests/*). Minimal parse: only list items under the
// top-level `packages:` key, and only the `dir/*` glob shape.
function workspacePackageDirs(repoRoot: string): string[] {
  const yaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const globs: string[] = [];
  let inPackages = false;
  for (const line of yaml.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
    } else if (/^\S/.test(line)) {
      inPackages = false;
    } else if (inPackages) {
      const item = /^\s+-\s*["']?([^"']+?)["']?\s*$/.exec(line);
      if (item) globs.push(item[1]);
    }
  }
  const dirs: string[] = [];
  for (const glob of globs) {
    if (!glob.endsWith("/*")) continue;
    const base = join(repoRoot, glob.slice(0, -2));
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        existsSync(join(base, entry.name, "package.json"))
      ) {
        dirs.push(join(base, entry.name));
      }
    }
  }
  return dirs;
}

function collectArtifacts(pkgDir: string): BuiltArtifact[] {
  const dist = join(pkgDir, "dist");
  if (!existsSync(dist)) return [];
  const out: BuiltArtifact[] = [];
  for (const entry of readdirSync(dist, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !BUILT_FILE.test(entry.name)) continue;
    const full = join(entry.parentPath, entry.name);
    out.push({ path: full, content: readFileSync(full, "utf8") });
  }
  return out;
}

// Raised when the tarball can't be produced or read — a broken/uninstalled tree,
// not a workspace-range violation. `pnpm pack` hard-errors on an uninstalled tree
// (ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL); we report that as a tooling
// problem so it's never mistaken for a real leak.
export class PackToolingError extends Error {}

/** The slice of `spawnSync` the packer uses — injectable so tests can fake a failing pack. */
export type SpawnLike = (
  command: string,
  args: string[],
  options: { cwd?: string; encoding: "utf8" },
) => { status: number | null; stdout: string; stderr: string };

// Pack a package the way the release does and hand back its packed manifest.
// Success keys off the pack exit code plus a tarball landing in `packDest` —
// never stderr, since pnpm's env/WARN noise is expected. The manifest is read
// straight out of the tarball via the system `tar` (present on ubuntu-latest and
// the dev box), which sidesteps adding a tar dependency knip would have to allow.
export function packedManifest(
  pkgDir: string,
  packDest: string,
  spawn: SpawnLike = spawnSync,
): PackedManifest {
  const pack = spawn("pnpm", ["pack", "--pack-destination", packDest], {
    cwd: pkgDir,
    encoding: "utf8",
  });
  const tarballs = existsSync(packDest)
    ? readdirSync(packDest).filter((f) => f.endsWith(".tgz"))
    : [];
  if (pack.status !== 0 || tarballs.length === 0) {
    throw new PackToolingError(
      `\`pnpm pack\` failed in ${pkgDir} (exit ${pack.status ?? "?"}, ` +
        `${tarballs.length} tarball(s) produced). Run \`pnpm install\` and ` +
        `\`pnpm build\` before the guard.\n${pack.stderr ?? ""}`,
    );
  }

  const tgz = join(packDest, tarballs[0]);
  const extract = spawn("tar", ["-xzOf", tgz, "package/package.json"], {
    encoding: "utf8",
  });
  if (extract.status !== 0 || !extract.stdout.trim()) {
    throw new PackToolingError(
      `could not read package/package.json from ${tgz} (tar exit ` +
        `${extract.status ?? "?"}).\n${extract.stderr ?? ""}`,
    );
  }
  return JSON.parse(extract.stdout) as PackedManifest;
}

/** A named workspace package and the manifest that names it. `dir` is absolute. */
export interface WorkspacePackage {
  name: string;
  dir: string;
  manifest: Manifest;
}

function workspacePackages(repoRoot: string): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const dir of workspacePackageDirs(repoRoot)) {
    const manifest = readManifest(join(dir, "package.json"));
    if (manifest.name) packages.push({ name: manifest.name, dir, manifest });
  }
  return packages;
}

const isPublishable = (pkg: WorkspacePackage): boolean =>
  pkg.manifest.private !== true;

/**
 * The workspace packages that reach npm. The release workflow needs one publish
 * step per entry, so its own tests derive the set from here rather than pinning
 * a count that goes stale the next time a package starts publishing.
 */
export function publishablePackages(repoRoot: string): WorkspacePackage[] {
  return workspacePackages(repoRoot).filter(isPublishable);
}

function main(): void {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const packages = workspacePackages(repoRoot);
  const privateNames = new Set(
    packages.filter((p) => !isPublishable(p)).map((p) => p.name),
  );
  const publishable = packages.filter(isPublishable);

  const violations: Violation[] = [];
  for (const { name, dir, manifest } of publishable) {
    violations.push(
      ...findViolations(
        {
          name,
          runtimeDeps: runtimeDepsOf(manifest),
          artifacts: collectArtifacts(dir),
        },
        privateNames,
      ),
    );
  }

  // Pack each publishable package into a throwaway temp dir *outside* the repo
  // (the default lands in the package cwd and would litter the tree ahead of
  // `format:check`) and check its packed manifest for unrewritten workspace
  // ranges. Each temp dir is removed in its own finally, so nothing survives an
  // exception mid-scan.
  try {
    for (const { dir } of publishable) {
      const dest = mkdtempSync(join(tmpdir(), "vestlang-pack-"));
      try {
        violations.push(
          ...findWorkspaceRangeViolations(packedManifest(dir, dest)),
        );
      } finally {
        rmSync(dest, { recursive: true, force: true });
      }
    }
  } catch (err) {
    if (!(err instanceof PackToolingError)) throw err;
    console.error(
      `Publish guard could not pack a package — this is a tooling problem, not a workspace-range leak:\n\n  ${err.message}`,
    );
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error("Published artifacts are not publishable as-is:\n");
    for (const v of violations) {
      console.error(`  [${v.package}] ${v.message}`);
    }
    console.error(
      `\n${violations.length} violation(s). A published package must reach only its runtime deps and Node builtins, and ship no unrewritten workspace ranges.`,
    );
    process.exit(1);
  }

  console.log(
    "Published artifacts are self-contained and their packed manifests carry no workspace ranges.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
