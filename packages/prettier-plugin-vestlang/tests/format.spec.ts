import { describe, it, expect } from "vitest";
import prettier from "prettier";
import plugin from "../dist/index.js"; // build first

describe("prettier-plugin-vestlang", () => {
  it("formats a simple schedule", async () => {
    const input = `
VEST FROM EVENT grant OVER 48 months EVERY 1 month
`;
    const output = await prettier.format(input, {
      plugins: [plugin],
      parser: "vestlang-parser",
    });

    expect(output).toMatchInlineSnapshot(`
"VEST FROM EVENT grant
  OVER 48 months EVERY 1 months
"
`);
  });
});
