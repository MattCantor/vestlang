// Guards the docs: every ```vest block in apps/docs/docs must parse. Reuses the
// same `lintMarkdown` the CLI / nvim use, so CI and the editor agree.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lintMarkdown } from "@vestlang/linter";
import { parse } from "@vestlang/dsl";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const docsDir = join(repoRoot, "apps/docs/docs");

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...markdownFiles(p));
    else if (/\.mdx?$/.test(ent.name)) out.push(p);
  }
  return out;
}

describe("docs vest blocks", () => {
  const files = markdownFiles(docsDir);

  it("finds docs to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = file.slice(repoRoot.length + 1);
    it(`vest blocks parse: ${rel}`, () => {
      const errors = lintMarkdown(readFileSync(file, "utf8"), parse).filter(
        (d) => d.severity === "error",
      );
      const report = errors
        .map((d) => `  ${rel}:${d.line}:${d.column} ${d.ruleId}: ${d.message}`)
        .join("\n");
      expect(errors, report ? `\n${report}` : undefined).toHaveLength(0);
    });
  }
});
