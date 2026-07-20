import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// @vestlang/vestlang bundles its own copies of the parser, the normalizer, and
// the linter. The server already depends on those packages directly, so importing
// the umbrella at runtime would load a second set into a long-lived stdio
// process. Only the build/test-only code under scripts/ may reach for it — that
// is where the published grammar guide is read and copied.

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("the umbrella package", () => {
  it("is imported by no file under src/", () => {
    const files = readdirSync(join(PACKAGE_DIR, "src"), {
      recursive: true,
      withFileTypes: true,
    }).filter((e) => e.isFile() && e.name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(join(file.parentPath, file.name), "utf8");
      expect(source, file.name).not.toContain("@vestlang/vestlang");
    }
  });

  it("is declared as a devDependency and nothing else", () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.dependencies["@vestlang/vestlang"]).toBeUndefined();
    expect(manifest.devDependencies["@vestlang/vestlang"]).toBeDefined();
  });
});
