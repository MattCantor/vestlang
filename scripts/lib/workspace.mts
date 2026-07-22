// Primitives shared by the workspace guards (`check-published-artifacts`,
// `check-mcp-changeset`): enumerate the workspace packages, read a package.json,
// scan a file for the module specifiers it reaches for, and the spawn seam both
// guards fake in their tests. Guard-specific logic stays in each guard.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// --- workspace discovery ---------------------------------------------------

/** The package.json fields the guards read. A raw manifest, not a packed one. */
export interface PackageManifest {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export function readManifest(file: string): PackageManifest {
  return JSON.parse(readFileSync(file, "utf8")) as PackageManifest;
}

// pnpm-workspace.yaml holds the authoritative package globs (the root
// package.json's `workspaces` omits tests/*). Minimal parse: list items under the
// top-level `packages:` key, `dir/*` shape only — enough for this repo's layout.
export function workspacePackageDirs(repoRoot: string): string[] {
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

// --- module specifiers -----------------------------------------------------

// The package name a bare specifier belongs to: the specifier with any subpath
// stripped, so `zod/mini` → `zod` and `@scope/pkg/sub` → `@scope/pkg`.
export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return parts[0];
}

// Every syntactic form a module specifier can hide in — a from-clause, a
// side-effect import, a dynamic import, a require.
const SPECIFIER_PATTERNS: readonly RegExp[] = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']/g,
];

// A real specifier stays on this charset. Bundled JS (e.g. a generated parser)
// carries string literals ending in a keyword like `from`, so a naive `from"…"`
// match can capture the gap between two adjacent literals — debris carrying
// whitespace, `;`, `=`; this rejects it before it's mistaken for an import.
const SPECIFIER_SHAPE = /^[\w@./:~-]+$/;

export function matchAll(content: string, pattern: RegExp): string[] {
  return [...content.matchAll(pattern)].map((m) => m[1]);
}

/** Every module specifier a file reaches for, across all four import forms. */
export function collectSpecifiers(content: string): string[] {
  return SPECIFIER_PATTERNS.flatMap((p) => matchAll(content, p)).filter((s) =>
    SPECIFIER_SHAPE.test(s),
  );
}

// --- spawn seam ------------------------------------------------------------

/** The slice of `spawnSync` the guards use — injectable so tests fake the child. */
export type SpawnLike = (
  command: string,
  args: string[],
  options: { cwd?: string; encoding: "utf8" },
) => { status: number | null; stdout: string; stderr: string };
