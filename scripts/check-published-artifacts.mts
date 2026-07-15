// Publish-readiness guard. A publishable package must be self-contained: every
// module specifier its *built* output reaches for — in the declarations and the
// JS — has to resolve for a fresh `npm install`, i.e. name a package in that
// manifest's runtime deps or a Node builtin. Private workspace packages never
// reach npm, so a built artifact that still imports one is a broken publish.
//
// The scan logic is a pure function (`findViolations`) so it can be exercised
// against fixture inputs; the CLI at the bottom is the thin live-tree wrapper.

import { isBuiltin } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  kind: "unresolved-specifier" | "private-runtime-dep";
  message: string;
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

  for (const artifact of pkg.artifacts) {
    for (const specifier of collectSpecifiers(artifact.content)) {
      if (isRelative(specifier)) continue;
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

interface Manifest {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const BUILT_FILE = /\.(?:d\.ts|d\.cts|d\.mts|js|cjs|mjs)$/;

function readManifest(file: string): Manifest {
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

function runtimeDepsOf(manifest: Manifest): string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
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

function main(): void {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const dirs = workspacePackageDirs(repoRoot);
  const manifests = new Map<string, { dir: string; manifest: Manifest }>();
  for (const dir of dirs) {
    const manifest = readManifest(join(dir, "package.json"));
    if (manifest.name) manifests.set(manifest.name, { dir, manifest });
  }

  const privateNames = new Set(
    [...manifests.values()]
      .filter(({ manifest }) => manifest.private === true)
      .map(({ manifest }) => manifest.name)
      .filter((n): n is string => Boolean(n)),
  );

  const violations: Violation[] = [];
  for (const { dir, manifest } of manifests.values()) {
    if (manifest.private === true || !manifest.name) continue;
    violations.push(
      ...findViolations(
        {
          name: manifest.name,
          runtimeDeps: runtimeDepsOf(manifest),
          artifacts: collectArtifacts(dir),
        },
        privateNames,
      ),
    );
  }

  if (violations.length > 0) {
    console.error("Published artifacts are not self-contained:\n");
    for (const v of violations) {
      console.error(`  [${v.package}] ${v.message}`);
    }
    console.error(
      `\n${violations.length} violation(s). A published package must reach only its runtime deps and Node builtins.`,
    );
    process.exit(1);
  }

  console.log("Published artifacts are self-contained.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
