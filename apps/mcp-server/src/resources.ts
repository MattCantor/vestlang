import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// resources/ sits at the package root, so this names the same directory from
// src/resources.ts and from dist/resources.js — and keeps naming it once the
// package is installed under someone else's node_modules. A build step fills it;
// nothing here reaches outside the package.
const RESOURCE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../resources",
);

type ResourceSpec = {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: string;
  file: string;
};

export const RESOURCES: ResourceSpec[] = [
  {
    name: "grammar",
    uri: "vestlang://docs/grammar",
    title: "Vestlang Authoring Guide",
    description:
      "The working reference for writing vestlang: the statement form and every clause, anchors and offsets, selectors, window conditions, PLUS/THEN composition, worked translations from plain English, and the mistakes that fail validation. Prose and examples rather than formal productions — every example in it is checked against the real parser and linter. Fetch this before composing a new vestlang statement.",
    mimeType: "text/markdown",
    file: "grammar.md",
  },
  {
    name: "spec",
    uri: "vestlang://docs/spec",
    title: "Simple Vesting Specification",
    description:
      "Proposed OCF-aligned simple vesting specification that vestlang targets. Useful context for why the DSL exists and how it maps to the OCT schema.",
    mimeType: "text/markdown",
    file: "spec.md",
  },
  {
    name: "evaluation",
    uri: "vestlang://docs/evaluation",
    title: "Vestlang Evaluation Semantics",
    description:
      "Explains the evaluation model: the two verdicts (`storable`, the firing-blind floor, and `resolvesTo`, the closed-world reading), the representable/pending/valid flags, absence assumptions, gate (BEFORE/AFTER) provisos, and the resolved/unresolved/impossible installment states. Fetch this to interpret vestlang_evaluate output; vestlang_evaluate_as_of partitions the same installments by date but carries no verdict.",
    mimeType: "text/markdown",
    file: "evaluation.md",
  },
  {
    name: "ast",
    uri: "vestlang://docs/ast",
    title: "Vestlang AST Reference",
    description:
      "Describes the raw vs. normalized AST and the invariants the normalizer enforces. Fetch this when consuming vestlang_parse or vestlang_compile output.",
    mimeType: "text/markdown",
    file: "ast.md",
  },
  {
    name: "examples",
    uri: "vestlang://examples/valid-statements",
    title: "Vestlang Examples by Intent",
    description:
      "Curated intent→syntax examples (time-based, milestone/event starts, selectors, conditions, cliffs, parallel schedules) — a supporting pattern reference. vestlang://docs/grammar is authoritative for syntax and constraints; validate composed statements with vestlang_lint.",
    mimeType: "text/markdown",
    file: "examples.md",
  },
  {
    name: "common-queries",
    uri: "vestlang://examples/common-queries",
    title: "Common Queries and Summary Fields",
    description:
      "Reference for the summary object on vestlang_evaluate_as_of, the vestlang_vested_between window tool, and the date-math tools. Fetch this when answering aggregation or date-arithmetic questions to avoid re-deriving numbers from installment arrays.",
    mimeType: "text/markdown",
    file: "common-queries.md",
  },
  {
    name: "authoring",
    uri: "vestlang://docs/authoring",
    title: "Authoring from a Narrative with Sparse Anchors",
    description:
      "The propose→verify→refine recipe for authoring vestlang from a loose narrative description plus a few known figures (a footnote tranche, fiscal-year-end balances). Fetch this before drafting when the description is informal or the evidence is sparse — it maps narrative phrases to observation kinds, walks the verify loop, and covers what to do when the anchors cannot discriminate between candidate schedules.",
    mimeType: "text/markdown",
    file: "authoring.md",
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
        const text = await readFile(resolve(RESOURCE_DIR, r.file), "utf8");
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
