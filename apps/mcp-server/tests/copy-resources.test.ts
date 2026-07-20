import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyResources } from "../scripts/copy-resources.js";
import { RESOURCE_SOURCES } from "../scripts/resource-sources.js";

// Runs against a temp directory rather than the package's own resources/, which
// the rest of the suite is reading from.

let dir: string | undefined;

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("copying the resource bodies", () => {
  it("leaves exactly one file per resource, named after it", async () => {
    dir = await mkdtemp(join(tmpdir(), "vestlang-mcp-copy-"));
    // A resource that has since been renamed or dropped would leave a file like
    // this behind, and the server would go on listing whatever the manifest says.
    await writeFile(join(dir, "stale.md"), "left over from an older manifest");

    await copyResources(dir);

    expect((await readdir(dir)).sort()).toEqual(
      Object.keys(RESOURCE_SOURCES)
        .map((name) => `${name}.md`)
        .sort(),
    );
  });
});
