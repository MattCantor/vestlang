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
      // Nested git worktrees the harness checks out inside the repo. They're
      // gitignored, but ESLint doesn't read .gitignore, so without this it would
      // descend into a worktree's copy of the tree (e.g. an apps/docs .tsx that
      // isn't in tsconfig.lint.json) and the type-aware rules would throw.
      "**/.claude/**",
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
      // Drift tripwire for the discriminated-union switches that recur across the
      // AST/blocker traversals. Strict on purpose: a `default` arm does NOT count
      // as exhaustive (considerDefault* is false), so adding a node/blocker kind
      // without a matching case is a build break here — the same guarantee
      // @vestlang/walk gets from assertNever, extended to every union switch.
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        {
          considerDefaultExhaustiveForUnions: false,
          requireDefaultForNonUnion: true,
        },
      ],
      // The per-space blocker brands (DeadBlocker / StaticImpossibleBlocker) are
      // minted by exactly two functions in blockerTree.ts (overridden below). A
      // brand cast anywhere else would forge a verdict-space tag the producer
      // never earned, defeating the whole point of the split — so ban the `as`
      // form (`x as DeadBlocker`, `xs as StaticImpossibleBlocker[]`) everywhere
      // else.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'TSAsExpression > TSTypeReference[typeName.name="DeadBlocker"]',
          message:
            "Brand casts to DeadBlocker are confined to packages/evaluator/src/interpret/blockerTree.ts (partitionResolutionBlockers).",
        },
        {
          selector:
            'TSAsExpression > TSTypeReference[typeName.name="StaticImpossibleBlocker"]',
          message:
            "Brand casts to StaticImpossibleBlocker are confined to packages/evaluator/src/interpret/blockerTree.ts (brandStatic).",
        },
        {
          selector:
            'TSAsExpression > TSArrayType > TSTypeReference[typeName.name="DeadBlocker"]',
          message:
            "Brand casts to DeadBlocker[] are confined to packages/evaluator/src/interpret/blockerTree.ts (partitionResolutionBlockers).",
        },
        {
          selector:
            'TSAsExpression > TSArrayType > TSTypeReference[typeName.name="StaticImpossibleBlocker"]',
          message:
            "Brand casts to StaticImpossibleBlocker[] are confined to packages/evaluator/src/interpret/blockerTree.ts (brandStatic).",
        },
        // Also the generic spelling `as Array<DeadBlocker>` / `as Array<StaticImpossibleBlocker>`,
        // so the `[]` ban above can't be sidestepped by switching array syntax.
        {
          selector:
            'TSAsExpression > TSTypeReference[typeName.name="Array"] > TSTypeParameterInstantiation > TSTypeReference[typeName.name="DeadBlocker"]',
          message:
            "Brand casts to Array<DeadBlocker> are confined to packages/evaluator/src/interpret/blockerTree.ts (partitionResolutionBlockers).",
        },
        {
          selector:
            'TSAsExpression > TSTypeReference[typeName.name="Array"] > TSTypeParameterInstantiation > TSTypeReference[typeName.name="StaticImpossibleBlocker"]',
          message:
            "Brand casts to Array<StaticImpossibleBlocker> are confined to packages/evaluator/src/interpret/blockerTree.ts (brandStatic).",
        },
      ],
    },
  },

  // The one sanctioned home for the brand casts: blockerTree.ts mints both
  // per-space brands, so the ban above is lifted here only.
  {
    files: ["packages/evaluator/src/interpret/blockerTree.ts"],
    rules: {
      "no-restricted-syntax": "off",
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
