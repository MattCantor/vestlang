import { describe, it, expect } from "vitest";
import { TEMPLATE, zodIssuesToValidationErrors } from "../src/canonical-schema";

// Run a template through the shared schema and the adapter, the way core does.
const validate = (t: unknown) => {
  const result = TEMPLATE.safeParse(t);
  if (result.success) return { valid: true, errors: [] as const };
  return {
    valid: false,
    errors: zodIssuesToValidationErrors(result.error.issues, t),
  };
};

const pathsOf = (errors: ReadonlyArray<{ path: string }>) =>
  errors.map((e) => e.path);

const scheduledStatement = (over: Record<string, unknown> = {}) => ({
  order: 1,
  schedule: { occurrences: 4, period: 1, period_type: "MONTHS" },
  percentage: "1",
  ...over,
});

const tmpl = (statements: unknown[]) => ({ id: "t", statements });

describe("zodIssuesToValidationErrors — the union adapter", () => {
  it("recovers a deep path in the scheduled arm (cliff.length)", () => {
    const { valid, errors } = validate(
      tmpl([
        scheduledStatement({
          schedule: {
            occurrences: 4,
            period: 1,
            period_type: "MONTHS",
            cliff: { length: -1, period_type: "MONTHS", percentage: "0.25" },
          },
        }),
      ]),
    );
    expect(valid).toBe(false);
    expect(pathsOf(errors)).toContain("statements[0].schedule.cliff.length");
    expect(errors).toContainEqual({
      path: "statements[0].schedule.cliff.length",
      message: "must be an integer >= 0",
    });
  });

  it("recovers schedule.period_type and the statement percentage path", () => {
    const { errors } = validate(
      tmpl([
        scheduledStatement({
          schedule: { occurrences: 1, period: 1, period_type: "WEEKS" },
        }),
      ]),
    );
    expect(pathsOf(errors)).toContain("statements[0].schedule.period_type");
  });

  it("recovers the cliff percentage path in the scheduled arm", () => {
    const { errors } = validate(
      tmpl([
        scheduledStatement({
          schedule: {
            occurrences: 4,
            period: 1,
            period_type: "MONTHS",
            cliff: { length: 2, period_type: "MONTHS", percentage: "1.5" },
          },
        }),
      ]),
    );
    expect(errors).toContainEqual({
      path: "statements[0].schedule.cliff.percentage",
      message: "must be in the closed interval [0, 1]",
    });
  });

  it("selects the milestone arm when there is no schedule (recovers .percentage)", () => {
    // A milestone (no `schedule` key) with a bad percentage collapses to an
    // invalid_union: arm 0 trips on the missing schedule, arm 1 on the percentage.
    // Picking the arm by `schedule` absence yields the clean percentage path.
    const { valid, errors } = validate(
      tmpl([
        {
          order: 1,
          percentage: "1.5e-3",
          event_condition: { event_id: "ipo" },
        },
      ]),
    );
    expect(valid).toBe(false);
    expect(pathsOf(errors)).toContain("statements[0].percentage");
    expect(errors).toContainEqual({
      path: "statements[0].percentage",
      message: "must be an OCF Numeric string",
    });
  });

  it("recovers event_condition.event_id in the milestone arm", () => {
    // A milestone with an empty event_id is matched cleanly to the milestone arm,
    // so its deep path surfaces directly (no union to unpack).
    const { errors } = validate(
      tmpl([{ order: 1, percentage: "1", event_condition: { event_id: "" } }]),
    );
    expect(errors).toContainEqual({
      path: "statements[0].event_condition.event_id",
      message: "must be a non-empty string",
    });
  });

  it("emits the neither-corner message at the statement path, with no sub-walk", () => {
    const { valid, errors } = validate(tmpl([{ order: 1, percentage: "1" }]));
    expect(valid).toBe(false);
    expect(errors).toEqual([
      {
        path: "statements[0]",
        message: "must carry a schedule, an event_condition, or both",
      },
    ]);
  });

  it("prefixes the correct index when the bad statement is not first", () => {
    const { errors } = validate(
      tmpl([
        scheduledStatement({ order: 1 }),
        { order: 2, percentage: "1" }, // neither-corner at index 1
      ]),
    );
    expect(errors).toContainEqual({
      path: "statements[1]",
      message: "must carry a schedule, an event_condition, or both",
    });
  });
});

describe("zodIssuesToValidationErrors — arm selection in isolation", () => {
  // Drive the adapter directly with a synthetic invalid_union issue so arm
  // selection is exercised without depending on how zod happens to order arms.
  const unionIssue = {
    code: "invalid_union" as const,
    message: "Invalid input",
    path: ["statements", 0] as const,
    errors: [
      // arm 0 (scheduled): a deep schedule issue
      [
        {
          code: "custom",
          message: "must be an integer >= 0",
          path: ["schedule", "cliff", "length"],
        },
      ],
      // arm 1 (milestone): a percentage issue
      [{ code: "custom", message: "must be >= 0", path: ["percentage"] }],
    ],
  };

  it("walks the scheduled arm (arm 0) when the input has a schedule key", () => {
    const errors = zodIssuesToValidationErrors([unionIssue], {
      statements: [{ schedule: {} }],
    });
    expect(errors).toEqual([
      {
        path: "statements[0].schedule.cliff.length",
        message: "must be an integer >= 0",
      },
    ]);
  });

  it("walks the milestone arm (arm 1) when the input has no schedule key", () => {
    const errors = zodIssuesToValidationErrors([unionIssue], {
      statements: [{ event_condition: { event_id: "ipo" } }],
    });
    expect(errors).toEqual([
      { path: "statements[0].percentage", message: "must be >= 0" },
    ]);
  });

  it("short-circuits to the neither-corner before any sub-walk", () => {
    const errors = zodIssuesToValidationErrors([unionIssue], {
      statements: [{ order: 1, percentage: "1" }],
    });
    expect(errors).toEqual([
      {
        path: "statements[0]",
        message: "must carry a schedule, an event_condition, or both",
      },
    ]);
  });

  it("passes non-union issues through by formatting their path", () => {
    const errors = zodIssuesToValidationErrors(
      [
        { code: "custom", message: "must be a non-empty string", path: ["id"] },
        {
          code: "custom",
          message: "must be a non-empty array",
          path: ["statements"],
        },
      ],
      {},
    );
    expect(errors).toEqual([
      { path: "id", message: "must be a non-empty string" },
      { path: "statements", message: "must be a non-empty array" },
    ]);
  });
});

describe("shared schema — wire-input corners", () => {
  // A hand-edited artifact can carry a wrong-typed scalar (a quoted number, a
  // numeric string field). The legacy message must survive the type mismatch,
  // not degrade to a generic "Invalid input".
  it("keeps the integer message when a number field is wrong-typed", () => {
    const { errors } = validate(tmpl([scheduledStatement({ order: "x" })]));
    expect(errors).toContainEqual({
      path: "statements[0].order",
      message: "must be an integer >= 1",
    });
  });

  it("keeps the Numeric message when a percentage is not a string", () => {
    const { errors } = validate(
      tmpl([scheduledStatement({ percentage: 0.5 })]),
    );
    expect(errors).toContainEqual({
      path: "statements[0].percentage",
      message: "must be an OCF Numeric string",
    });
  });

  it("keeps the id message when id is wrong-typed", () => {
    const { errors } = validate({ id: 7, statements: [scheduledStatement()] });
    expect(errors).toContainEqual({
      path: "id",
      message: "must be a non-empty string",
    });
  });

  // A stray key reports against the statement itself (empty sub-path) — the path
  // must stay `statements[0]`, never a malformed `statements[0].`.
  it("reports an unrecognized key without a trailing dot", () => {
    const { valid, errors } = validate(
      tmpl([scheduledStatement({ foo: "nope" })]),
    );
    expect(valid).toBe(false);
    expect(pathsOf(errors)).toContain("statements[0]");
    expect(errors.every((e) => !e.path.endsWith("."))).toBe(true);
  });

  // A non-object array element is named for what it is, not blamed on a missing
  // schedule/event the way the bare neither-corner check would.
  it("names a non-object statement element", () => {
    const { errors } = validate(tmpl(["nope"]));
    expect(errors).toContainEqual({
      path: "statements[0]",
      message: "must be an object",
    });
  });
});
