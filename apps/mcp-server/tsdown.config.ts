import { defineConfig } from "tsdown";

// Core is inlined here, unlike in the umbrella's config — the umbrella declares
// core as a real runtime dep, while the published server declares exactly two
// (the MCP SDK and zod), so a surviving `from "@vestlang/core"` would be
// unresolvable on install. @vestlang/evaluator and @vestlang/pipeline both reach
// for it, hence no negative lookahead in the catch-all.
//
// resources.ts is a second entry because dist/resources.js is imported on its
// own (relocated-package.test.ts loads it from a temp dir); dist/index.js can't
// stand in, it calls main() at the top level.
export default defineConfig({
  entry: ["src/index.ts", "src/resources.ts"],
  format: ["esm"],
  fixedExtension: false,
  dts: false,
  clean: true,
  deps: { alwaysBundle: [/@vestlang\//] },
});
