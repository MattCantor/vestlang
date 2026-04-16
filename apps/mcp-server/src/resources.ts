import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// From apps/mcp-server/{src,dist}/resources.{ts,js} up to repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

type ResourceSpec = {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: string;
  path: string;
};

const RESOURCES: ResourceSpec[] = [
  {
    name: "grammar",
    uri: "vestlang://docs/grammar",
    title: "Vestlang DSL Grammar",
    description:
      "Full grammar reference for the vestlang DSL (schedule expressions, vesting anchors, conditions, durations). Fetch this before composing a new vestlang statement.",
    mimeType: "text/markdown",
    path: "apps/docs/docs/dsl_grammar.md",
  },
  {
    name: "spec",
    uri: "vestlang://docs/spec",
    title: "Simple Vesting Specification",
    description:
      "Proposed OCF-aligned simple vesting specification that vestlang targets. Useful context for why the DSL exists and how it maps to the OCT schema.",
    mimeType: "text/markdown",
    path: "docs/simple-vesting-spec.md",
  },
  {
    name: "evaluation",
    uri: "vestlang://docs/evaluation",
    title: "Vestlang Evaluation Semantics",
    description:
      "Explains the evaluation pipeline: evaluation context, resolved/unresolved/impossible installment states, blockers, and allocation modes. Fetch this when interpreting vestlang_evaluate or vestlang_evaluate_as_of output.",
    mimeType: "text/markdown",
    path: "apps/docs/docs/evaluation.md",
  },
  {
    name: "ast",
    uri: "vestlang://docs/ast",
    title: "Vestlang AST Reference",
    description:
      "Describes the raw vs. normalized AST and the invariants the normalizer enforces. Fetch this when consuming vestlang_parse or vestlang_compile output.",
    mimeType: "text/markdown",
    path: "apps/docs/docs/ast.md",
  },
  {
    name: "examples",
    uri: "vestlang://examples/valid-statements",
    title: "Example Vestlang Statements",
    description:
      "A curated list of valid vestlang statements covering immediate, time-based, milestone-based, and conditional vesting. Use as pattern reference when generating new statements.",
    mimeType: "text/plain",
    path: "packages/dsl/tests/validStatements.vest",
  },
  {
    name: "common-queries",
    uri: "vestlang://examples/common-queries",
    title: "Common Queries and Summary Fields",
    description:
      "Reference for the summary object on vestlang_evaluate_as_of, the vestlang_vested_between window tool, and the date-math tools. Fetch this when answering aggregation or date-arithmetic questions to avoid re-deriving numbers from installment arrays.",
    mimeType: "text/markdown",
    path: "apps/docs/docs/common_queries.md",
  },
];

export function registerResources(server: McpServer): void {
  for (const r of RESOURCES) {
    server.registerResource(
      r.name,
      r.uri,
      {
        title: r.title,
        description: r.description,
        mimeType: r.mimeType,
      },
      async (uri) => {
        const abs = resolve(REPO_ROOT, r.path);
        const text = await readFile(abs, "utf8");
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: r.mimeType,
              text,
            },
          ],
        };
      },
    );
  }
}
