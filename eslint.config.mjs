import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import turboConfig from "eslint-config-turbo/flat";
import prettier from "eslint-config-prettier";

// Flat ESLint config for the whole monorepo, run once from the root (`eslint .`).
// vestlang is a pure-TS library — no React/Tailwind — so this is the
// type-aware typescript-eslint baseline plus import-hygiene and turbo env
// checks, with Prettier owning all formatting (its rules are switched off here).
//
// Type-aware rules use the whole-repo `tsconfig.lint.json` program (src + tests).
export default tseslint.config(
  {
    // Generated, built, vendored, and non-TS-source trees.
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "packages/dsl/src/generated/**",
      "apps/docs/**",
      "docs/**",
      "**/*.peggy",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...turboConfig,

  {
    files: ["**/*.ts", "**/*.mts", "**/*.cts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.lint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      // Catch circular dependencies — the kind the recent dependency-arrow
      // refactor was about — and self-imports.
      "import/no-cycle": ["error", { maxDepth: 1 }],
      "import/no-self-import": "error",
      // `_`-prefixed args/vars are intentional throwaways.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The any-family is on. `no-explicit-any` bans literal `any`; the five
      // type-flow `no-unsafe-*` rules catch `any` values leaking in from untyped
      // boundaries. They run on source; the test override below relaxes the
      // `no-unsafe-*` set, where loosely-typed parse output and partial fixtures
      // make them noise rather than signal.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      // `interface Foo extends Bar {}` is a deliberate named alias here.
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" },
      ],
      // MCP/CLI handlers are idiomatically `async` even when their current body
      // has no `await` (the signature is the contract); don't force churn there.
      "@typescript-eslint/require-await": "off",
    },
  },

  // Tests legitimately poke at loosely-typed parse output and build partial
  // fixtures, so the type-flow `no-unsafe-*` rules add ceremony there without
  // real safety gain. Relax them in test files only (`no-explicit-any` stays on).
  {
    files: ["**/*.{test,spec}.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },

  // Plain JS (the flat config itself, any stray scripts) runs outside the TS
  // type program, so type-aware rules can't apply.
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },

  // Prettier last: turn off every formatting-related rule.
  prettier,
);
