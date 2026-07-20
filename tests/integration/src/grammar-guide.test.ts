import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INDETERMINATE_SENTINEL,
  VESTLANG_AUTHORING_PROMPT,
  VESTLANG_GRAMMAR_GUIDE,
} from "@vestlang/vestlang/authoring";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PROMPT_SOURCE = readFileSync(
  join(repoRoot, "packages/vestlang/src/authoring/prompt.ts"),
  "utf8",
);

// The guide is published as an MCP resource, so its body lands in a chat host's
// context. Anything written for a program answering one API call becomes an
// instruction that host will follow — and a user asking about their vesting gets
// back a bare DSL string, or a sentinel word.
describe("the grammar guide", () => {
  it("carries no reply-format rule", () => {
    expect(VESTLANG_GRAMMAR_GUIDE).not.toContain(
      "Reply with vestlang source and nothing else",
    );
    expect(VESTLANG_GRAMMAR_GUIDE).not.toContain(
      "wrapped in prose or a code fence",
    );
  });

  it("carries no sentinel, including in the worked translation that taught it", () => {
    expect(VESTLANG_GRAMMAR_GUIDE).not.toContain(INDETERMINATE_SENTINEL);
    // The prompt still teaches the don't-guess rule by example; the guide has to
    // keep teaching it, in its own words.
    expect(VESTLANG_GRAMMAR_GUIDE).toContain(
      "Vests as set forth in the participant's award agreement.",
    );
  });
});

// Two near-identical 7 KB literals would reintroduce exactly the duplication the
// guide exists to remove. What keeps them honest is that they are one template:
// the shared sentences below appear once in the source, and both constants get
// them from there.
describe("the prompt and the guide", () => {
  const SHARED = [
    "OVER is the total span, EVERY the cadence.",
    "Offsets stack, and mixed units always apply months first",
    "vestingStart cannot anchor a FROM (it would define itself)",
    "# Mistakes that fail validation",
  ];

  it.each(SHARED)("writes %j once and hands it to both", (sentence) => {
    expect(PROMPT_SOURCE.split(sentence).length - 1).toBe(1);
    expect(VESTLANG_AUTHORING_PROMPT).toContain(sentence);
    expect(VESTLANG_GRAMMAR_GUIDE).toContain(sentence);
  });

  it("emit a byte-identical grammar section", () => {
    const section = (text: string) =>
      text.slice(
        text.indexOf("# The statement"),
        text.indexOf("# Worked translations"),
      );
    expect(section(VESTLANG_GRAMMAR_GUIDE).length).toBeGreaterThan(4000);
    expect(section(VESTLANG_GRAMMAR_GUIDE)).toBe(
      section(VESTLANG_AUTHORING_PROMPT),
    );
  });
});
