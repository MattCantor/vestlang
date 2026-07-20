import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RESOURCE_SOURCES, readSource } from "./resource-sources.js";

// The server serves markdown that lives elsewhere — six docs-site pages and one
// constant from @vestlang/vestlang. Rather than have it reach out at read time
// (which only ever worked inside a git checkout), the bodies are copied into a
// package-local resources/ directory that travels with the package. The copy is a
// build artifact: gitignored, rewritten on every build and every test run.

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Matches the directory src/resources.ts reads from. */
export const RESOURCE_DIR = join(PACKAGE_ROOT, "resources");

/**
 * Write every resource body into `destination`, which is emptied first so a
 * renamed or dropped resource cannot leave a stale file behind. Bytes are
 * preserved exactly — no EOL or encoding rewrite.
 */
export async function copyResources(
  destination: string = RESOURCE_DIR,
): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await Promise.all(
    Object.entries(RESOURCE_SOURCES).map(async ([name, source]) =>
      writeFile(join(destination, `${name}.md`), await readSource(source)),
    ),
  );
}

/** vitest's globalSetup hook — `pnpm test` never runs the package's own build. */
export async function setup(): Promise<void> {
  await copyResources();
}

// The package's prebuild hook runs this file directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await copyResources();
}
