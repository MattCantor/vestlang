import { beforeEach, describe, expect, it, vi } from "vitest";

// Every HTTP request builds a fresh McpServer, so anything createServer() reads
// off disk is paid per request. The version read is module-scope and resource
// bodies load inside the read callback; this is what holds them there.
// Paths land here unstringified — a failing assertion prints them as they are.
const reads = vi.hoisted(() => [] as unknown[]);

vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    reads.push(args[0]);
    return actual.readFileSync(...args);
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync, default: { ...actual, readFileSync } };
});

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const readFile = ((...args: Parameters<typeof actual.readFile>) => {
    reads.push(args[0]);
    return actual.readFile(...args);
  }) as typeof actual.readFile;
  return { ...actual, readFile, default: { ...actual, readFile } };
});

const { createServer } = await import("../src/server.js");

beforeEach(() => {
  reads.length = 0;
});

describe("createServer", () => {
  it("touches no filesystem, however many servers are built", () => {
    for (let i = 0; i < 5; i++) createServer();
    expect(reads).toEqual([]);
  });

  it("is watched by a spy that does see a read", async () => {
    // Without this, the assertion above would pass just as happily against a
    // mock that had quietly stopped intercepting.
    const manifest = new URL("../package.json", import.meta.url);
    const { readFileSync } = await import("node:fs");
    const { readFile } = await import("node:fs/promises");

    readFileSync(manifest, "utf8");
    await readFile(manifest, "utf8");

    expect(reads).toHaveLength(2);
  });
});
