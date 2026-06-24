import { describe, expect, it } from "vitest";
import { validateVestingScheduleTemplate } from "@vestlang/core";
import { MAX_INSTALLMENTS } from "@vestlang/primitives";
import { PERSISTED_ARTIFACT } from "../src/artifact-schema.js";

// The whole point of the shared schema: core's structural validator and the MCP
// server's persisted-artifact validator can no longer disagree about which
// templates are well-formed — they parse the same definition. This battery feeds
// each malformed template to both and asserts they reach the same verdict. Each
// template is wrapped in a minimal *valid* runtime, so only the template arm
// decides whether the artifact parses.

const VALID_RUNTIME = { startDate: "2025-01-01" };

// A structurally valid scheduled statement, varied per case.
const scheduled = (over: Record<string, unknown> = {}) => ({
  order: 1,
  schedule: { occurrences: 4, period: 1, period_type: "MONTHS" },
  percentage: "1",
  ...over,
});

interface Case {
  name: string;
  template: unknown;
  valid: boolean;
}

const cases: Case[] = [
  {
    name: "valid control",
    template: { id: "t", statements: [scheduled()] },
    valid: true,
  },
  {
    name: "empty id",
    template: { id: "", statements: [scheduled()] },
    valid: false,
  },
  {
    name: "empty statements",
    template: { id: "t", statements: [] },
    valid: false,
  },
  {
    name: "oversized percentage",
    template: {
      id: "t",
      statements: [scheduled({ percentage: "99999999999999999999" })],
    },
    valid: false,
  },
  {
    name: "negative percentage",
    template: { id: "t", statements: [scheduled({ percentage: "-0.5" })] },
    valid: false,
  },
  {
    name: "cliff percentage outside [0, 1]",
    template: {
      id: "t",
      statements: [
        scheduled({
          schedule: {
            occurrences: 4,
            period: 1,
            period_type: "MONTHS",
            cliff: { length: 2, period_type: "MONTHS", percentage: "1.5" },
          },
        }),
      ],
    },
    valid: false,
  },
  {
    name: "bad period_type",
    template: {
      id: "t",
      statements: [
        scheduled({
          schedule: { occurrences: 1, period: 1, period_type: "WEEKS" },
        }),
      ],
    },
    valid: false,
  },
  {
    name: "occurrences < 1",
    template: {
      id: "t",
      statements: [
        scheduled({
          schedule: { occurrences: 0, period: 1, period_type: "MONTHS" },
        }),
      ],
    },
    valid: false,
  },
  {
    name: "duplicate order",
    template: {
      id: "t",
      statements: [
        scheduled({ order: 1, percentage: "0.5" }),
        scheduled({ order: 1, percentage: "0.5" }),
      ],
    },
    valid: false,
  },
  {
    name: "over the installment cap",
    template: {
      id: "t",
      statements: [
        scheduled({
          schedule: {
            occurrences: MAX_INSTALLMENTS + 1,
            period: 1,
            period_type: "MONTHS",
          },
        }),
      ],
    },
    valid: false,
  },
  {
    name: "neither-corner",
    template: { id: "t", statements: [{ order: 1, percentage: "1" }] },
    valid: false,
  },
];

describe("anti-drift battery — core and mcp agree per template", () => {
  for (const c of cases) {
    it(`${c.name}: both verdicts are ${c.valid ? "valid" : "invalid"}`, () => {
      const coreVerdict = validateVestingScheduleTemplate(
        c.template as Parameters<typeof validateVestingScheduleTemplate>[0],
      ).structurallyValid;
      const mcpVerdict = PERSISTED_ARTIFACT.safeParse({
        template: c.template,
        runtime: VALID_RUNTIME,
      }).success;

      // The load-bearing assertion: the two surfaces agree.
      expect(coreVerdict).toBe(mcpVerdict);
      // And both land on the expected verdict.
      expect(coreVerdict).toBe(c.valid);
    });
  }
});

// The MCP server's persisted-artifact schema used to be *behind* core: its cliff
// percentage had no [0, 1] bound, its id/statements weren't required non-empty,
// and it enforced neither duplicate-order nor the installment cap. Sharing core's
// schema closes that gap. These fixtures prove the gap is closed, positively —
// each is something the old wire schema accepted and the new one must reject.
describe("PERSISTED_ARTIFACT — now rejects what it used to accept", () => {
  const reject = (template: unknown) =>
    PERSISTED_ARTIFACT.safeParse({ template, runtime: VALID_RUNTIME }).success;

  it("rejects a cliff percentage outside [0, 1]", () => {
    expect(
      reject({
        id: "t",
        statements: [
          scheduled({
            schedule: {
              occurrences: 4,
              period: 1,
              period_type: "MONTHS",
              cliff: { length: 2, period_type: "MONTHS", percentage: "1.5" },
            },
          }),
        ],
      }),
    ).toBe(false);
  });

  it("rejects an oversized statement percentage", () => {
    expect(
      reject({
        id: "t",
        statements: [scheduled({ percentage: "99999999999999999999" })],
      }),
    ).toBe(false);
  });

  it("rejects a negative statement percentage", () => {
    expect(
      reject({ id: "t", statements: [scheduled({ percentage: "-0.5" })] }),
    ).toBe(false);
  });

  it("rejects a duplicate order", () => {
    expect(
      reject({
        id: "t",
        statements: [
          scheduled({ order: 1, percentage: "0.5" }),
          scheduled({ order: 1, percentage: "0.5" }),
        ],
      }),
    ).toBe(false);
  });

  it("rejects a template over MAX_INSTALLMENTS", () => {
    expect(
      reject({
        id: "t",
        statements: [
          scheduled({
            schedule: {
              occurrences: MAX_INSTALLMENTS + 1,
              period: 1,
              period_type: "MONTHS",
            },
          }),
        ],
      }),
    ).toBe(false);
  });

  it("rejects an empty id", () => {
    expect(reject({ id: "", statements: [scheduled()] })).toBe(false);
  });

  it("rejects an empty statements array", () => {
    expect(reject({ id: "t", statements: [] })).toBe(false);
  });
});
