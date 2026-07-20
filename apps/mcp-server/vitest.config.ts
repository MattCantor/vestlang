import { defineConfig } from "vitest/config";

// resources/ is a build artifact, and `vitest` started straight from the package
// — by hand, or from an editor — never runs the build that fills it. Copy it here
// too, so a bare test run reads the same bodies a built package ships.
export default defineConfig({
  test: {
    globalSetup: ["./scripts/copy-resources.ts"],
  },
});
