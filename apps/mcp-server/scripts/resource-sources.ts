import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VESTLANG_GRAMMAR_GUIDE } from "@vestlang/vestlang/authoring";

// Build- and test-time only. Nothing under src/ may import this module: it reaches
// across the repo for the docs pages, and it pulls in @vestlang/vestlang, which
// bundles a second copy of the parser, normalizer, and linter the server already
// depends on directly.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Where one resource's text comes from. Six are docs-site pages; the grammar
 * guide is a constant published by @vestlang/vestlang. Both arms are files by the
 * time the server reads them, so this distinction lives here and nowhere else.
 */
export type ResourceSource =
  | { from: "file"; path: string }
  | { from: "constant"; text: string };

/** Keyed by the resource `name` in src/resources.ts, which also names the copy. */
export const RESOURCE_SOURCES: Record<string, ResourceSource> = {
  grammar: { from: "constant", text: VESTLANG_GRAMMAR_GUIDE },
  spec: { from: "file", path: "docs/simple-vesting-spec.md" },
  evaluation: { from: "file", path: "apps/docs/docs/evaluation.md" },
  ast: { from: "file", path: "apps/docs/docs/ast.md" },
  examples: { from: "file", path: "apps/docs/docs/examples.md" },
  "common-queries": { from: "file", path: "apps/docs/docs/common_queries.md" },
  authoring: { from: "file", path: "apps/docs/docs/authoring.md" },
};

/** The bytes that will be copied, read from wherever the source lives. */
export async function readSource(source: ResourceSource): Promise<Buffer> {
  return source.from === "constant"
    ? Buffer.from(source.text, "utf8")
    : readFile(resolve(REPO_ROOT, source.path));
}

/** Absolute path of a file-backed source, for the tests that pin page content. */
export function sourcePath(name: string): string {
  const source = RESOURCE_SOURCES[name];
  if (source?.from !== "file") {
    throw new Error(`resource "${name}" is not backed by a file`);
  }
  return resolve(REPO_ROOT, source.path);
}
