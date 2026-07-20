import { afterAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { appendFile, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The condition this reproduces is "installed": dist/ and resources/ sitting
// somewhere that is not a checkout of this repo. Nothing about an in-repo path
// assertion can tell a correct implementation apart from one that walks to the
// repo root and spells out the destination — both pass in place, and only one of
// them still works here.

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type ResourceRead = (uri: URL) => Promise<{ contents: { text: string }[] }>;
type CopiedModule = {
  RESOURCES: { name: string; uri: string }[];
  registerResources: (server: unknown) => void;
};

let installDir: string | undefined;

afterAll(async () => {
  if (installDir) await rm(installDir, { recursive: true, force: true });
});

describe("a relocated package", () => {
  it("serves every resource out of its own directory", async () => {
    const dist = join(PACKAGE_DIR, "dist");
    expect(
      existsSync(join(dist, "resources.js")),
      "dist/resources.js is missing — build the package before running this",
    ).toBe(true);

    const home = await mkdtemp(join(tmpdir(), "vestlang-mcp-install-"));
    installDir = home;
    await Promise.all([
      // Source maps would point back into the repo, and vitest says so loudly.
      cp(dist, join(home, "dist"), {
        recursive: true,
        filter: (source) => !source.endsWith(".map"),
      }),
      cp(join(PACKAGE_DIR, "resources"), join(home, "resources"), {
        recursive: true,
      }),
    ]);

    // Stamp the relocated copies. A body served from anywhere else — the repo's
    // own resources/, a docs page — arrives without its stamp.
    const stamp = (name: string) => `\n<!-- served from ${name} -->\n`;

    // The manifest and the reader both come from the relocated dist, imported by
    // absolute path so nothing resolves back through the repo.
    const module = (await import(
      pathToFileURL(join(home, "dist/resources.js")).href
    )) as CopiedModule;
    expect(module.RESOURCES.length).toBeGreaterThan(0);

    await Promise.all(
      module.RESOURCES.map((r) =>
        appendFile(join(home, "resources", `${r.name}.md`), stamp(r.name)),
      ),
    );

    // registerResources only ever calls back into the object it is handed, so a
    // recorder stands in for McpServer and the SDK stays out of the temp dir.
    const reads = new Map<string, ResourceRead>();
    module.registerResources({
      registerResource: (
        _name: string,
        uri: string,
        _metadata: unknown,
        read: ResourceRead,
      ) => reads.set(uri, read),
    });
    expect(reads.size).toBe(module.RESOURCES.length);

    for (const r of module.RESOURCES) {
      const result = await reads.get(r.uri)!(new URL(r.uri));
      const text = result.contents.map((c) => c.text).join("");
      expect(text.trim().length, r.uri).toBeGreaterThan(0);
      expect(text.endsWith(stamp(r.name)), r.uri).toBe(true);
    }
  });
});
