// The publish guard accepts a relative `.js` specifier in a declaration file
// when only its `.d.ts` sibling was emitted (a shared declaration chunk whose
// importers still spell it `.js`). That leniency only earns its keep if the
// umbrella's build actually produces such a chunk — otherwise `check:artifacts`
// passes without ever touching the rule. This reads the *built* dist and pins
// the scenario is present, so a future chunking change that stops emitting a
// shared declaration chunk turns CI red instead of leaving the guard vacuous.
//
// Depends on a prior `pnpm build`; CI builds before it tests.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dist = join(repoRoot, "packages/vestlang/dist");

const DECLARATION_FILE = /\.d\.(?:ts|cts|mts)$/;
const SIBLING_EXT: Record<string, string> = {
  ".js": ".d.ts",
  ".cjs": ".d.cts",
  ".mjs": ".d.mts",
};

// Relative specifiers ending in a JS extension, across every syntactic form a
// declaration file uses to reach a sibling chunk.
const RELATIVE_JS_SPECIFIER =
  /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'](\.[^"']+\.(?:js|cjs|mjs))["']/g;

function siblingOf(specifier: string): string {
  for (const [js, dts] of Object.entries(SIBLING_EXT)) {
    if (specifier.endsWith(js)) return specifier.slice(0, -js.length) + dts;
  }
  throw new Error(`not a JS specifier: ${specifier}`);
}

describe("built umbrella declarations exercise the sibling-resolution rule", () => {
  it("emits a declaration with a relative JS specifier resolving only via a .d.ts sibling", () => {
    expect(
      existsSync(dist),
      `${dist} is missing — run \`pnpm build\` before this test`,
    ).toBe(true);

    const declarationFiles = readdirSync(dist, {
      recursive: true,
      withFileTypes: true,
    }).filter((e) => e.isFile() && DECLARATION_FILE.test(e.name));

    const resolvesOnlyViaSibling = declarationFiles.some((entry) => {
      const dir = entry.parentPath;
      const content = readFileSync(join(dir, entry.name), "utf8");
      return [...content.matchAll(RELATIVE_JS_SPECIFIER)].some(
        ([, specifier]) => {
          const literal = join(dir, specifier);
          const sibling = join(dir, siblingOf(specifier));
          return !existsSync(literal) && existsSync(sibling);
        },
      );
    });

    expect(
      resolvesOnlyViaSibling,
      "no built declaration references a relative JS chunk that resolves only " +
        "via its declaration sibling — the guard's sibling-resolution rule is " +
        "no longer exercised by the real build; adjust the dist chunking or " +
        "retire the rule",
    ).toBe(true);
  });
});
