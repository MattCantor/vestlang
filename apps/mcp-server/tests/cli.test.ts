import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, readHttpConfig } from "../src/cli.js";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("argument parsing", () => {
  it("takes no arguments as stdio and --http as HTTP", () => {
    expect(parseArgs([])).toEqual({ mode: "stdio" });
    expect(parseArgs(["--http"])).toEqual({ mode: "http" });
  });

  it("refuses anything else rather than falling back to stdio", () => {
    // The failure this prevents: a typo'd flag starting a stdio server that
    // nothing is talking to.
    for (const argv of [["--htpp"], ["--http", "--extra"], ["serve"]]) {
      const parsed = parseArgs(argv);
      expect(parsed.mode, argv.join(" ")).toBe("usage-error");
      expect(parsed.mode === "usage-error" && parsed.message).toContain(
        "Usage:",
      );
    }
  });

  it("sends the usage error to stderr and exits non-zero", async () => {
    const entry = join(PACKAGE_DIR, "dist/index.js");
    expect(
      existsSync(entry),
      "dist/index.js is missing — build the package before running this",
    ).toBe(true);

    const { code, stderr } = await run(entry, ["--htpp"]);
    expect(code).toBe(1);
    expect(stderr).toContain("--htpp");
    expect(stderr).toContain("Usage:");
  });
});

describe("HTTP configuration from the environment", () => {
  it("defaults to port 3000 on localhost with no allowlist", () => {
    expect(readHttpConfig({})).toEqual({
      ok: true,
      config: { port: 3000, host: "127.0.0.1", allowedHosts: undefined },
    });
  });

  it("reads each knob", () => {
    expect(
      readHttpConfig({
        VESTLANG_MCP_PORT: "8080",
        VESTLANG_MCP_HOST: "0.0.0.0",
        VESTLANG_MCP_ALLOWED_HOSTS: "vestlang.internal, [::1] ,localhost",
      }),
    ).toEqual({
      ok: true,
      config: {
        port: 8080,
        host: "0.0.0.0",
        allowedHosts: ["vestlang.internal", "[::1]", "localhost"],
      },
    });
  });

  it("treats an all-empty allowlist as unset", () => {
    // Split naively, "" yields [""] — truthy, so the SDK would install host
    // validation that rejects every request, with nothing said about why.
    for (const value of ["", "  ", ",", " , "]) {
      const result = readHttpConfig({ VESTLANG_MCP_ALLOWED_HOSTS: value });
      expect(
        result.ok && result.config.allowedHosts,
        JSON.stringify(value),
      ).toBe(undefined);
    }
  });

  it("refuses a port that is not a usable port number", () => {
    // listen(NaN) would otherwise bind an arbitrary port nobody can reach, and
    // a bound 0 is one nobody can predict.
    for (const value of ["abc", "80.5", "3e3", "8080x", "0", "65536", "-1"]) {
      const result = readHttpConfig({ VESTLANG_MCP_PORT: value });
      expect(result.ok, value).toBe(false);
      expect(!result.ok && result.message, value).toContain(
        "VESTLANG_MCP_PORT",
      );
    }
  });
});

function run(
  entry: string,
  args: string[],
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [entry, ...args], (error, _stdout, stderr) => {
      // execFile reports a non-zero exit as an error carrying that status.
      resolve({
        code: typeof error?.code === "number" ? error.code : 0,
        stderr,
      });
    });
  });
}
