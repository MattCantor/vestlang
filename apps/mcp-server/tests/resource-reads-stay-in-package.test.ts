import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Serving a resource must never read outside this package. It used to: the base
// directory was the repo root, walked up from the module's own URL, which resolves
// to the consumer's node_modules once the package is installed. Watch the file
// reads a resource read actually performs rather than the paths the manifest
// declares — a spelled-out repo-relative destination would satisfy the latter.

const readPaths = vi.hoisted(() => [] as string[]);

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = (...args: Parameters<typeof actual.readFile>) => {
    // Resource reads pass an absolute string path. Anything else is recorded in
    // a form that cannot pass the containment check below rather than skipped.
    const [target] = args;
    readPaths.push(
      typeof target === "string" ? target : JSON.stringify(target),
    );
    return actual.readFile(...args);
  };
  return { ...actual, readFile, default: { ...actual, readFile } };
});

const { createServer } = await import("../src/server.js");

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("resource reads", () => {
  it("touch no file outside the package directory", async () => {
    const server = createServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const { resources } = await client.listResources();
    expect(resources.length).toBeGreaterThan(0);

    readPaths.length = 0;
    for (const { uri } of resources) {
      await client.readResource({ uri });
    }

    expect(readPaths.length).toBe(resources.length);
    for (const path of readPaths) {
      expect(path.startsWith(`${PACKAGE_DIR}/`), path).toBe(true);
    }
  });
});
