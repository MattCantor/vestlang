import { beforeEach, describe, expect, it, vi } from "vitest";

// Every HTTP request builds a fresh McpServer, so anything createServer() reads
// off disk is paid per request. The version read is module-scope and resource
// bodies load inside the read callback — which is what an fs spy can prove and a
// wall-clock bound never could.
const reads = vi.hoisted(() => [] as string[]);

// Named for a legible failure ("it read package.json"), not for matching.
function pathLabel(path: unknown): string {
  if (typeof path === "string") return path;
  if (path instanceof URL) return path.href;
  if (Buffer.isBuffer(path)) return path.toString("utf8");
  return typeof path === "number" ? `fd ${path}` : "<file handle>";
}

vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    reads.push(pathLabel(args[0]));
    return actual.readFileSync(...args);
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync, default: { ...actual, readFileSync } };
});

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const readFile = ((...args: Parameters<typeof actual.readFile>) => {
    reads.push(pathLabel(args[0]));
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
});
