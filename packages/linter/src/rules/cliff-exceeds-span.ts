import { Duration, VestingNodeExpr } from "@vestlang/types";
import { RuleModule } from "../types.js";

const meta = {
  id: "cliff-exceeds-span",
  description:
    "A CLIFF longer than its own segment's grid span (occurrences × period) lumps the whole segment onto a date past where its grid ends.",
  recommended: true,
  severity: "warning" as const,
};

// The cliff offset of a plain `vestingStart + <duration>` cliff: a single vesting
// node on the vestingStart anchor with one positive duration and no condition. Any
// richer shape (an event anchor, a condition, a selector, multiple offsets) isn't
// a single comparable duration, so we don't second-guess it here.
function startRelativeOffset(expr: VestingNodeExpr): Duration | undefined {
  if (
    expr.type !== "NODE" ||
    expr.base.type !== "EVENT" ||
    expr.base.value !== "vestingStart" ||
    expr.condition !== undefined ||
    expr.offsets.length !== 1
  )
    return undefined;
  const off = expr.offsets[0];
  return off.sign === "PLUS" ? off : undefined;
}

const unit = (u: string, n: number) =>
  `${n} ${n === 1 ? u.toLowerCase().replace(/s$/, "") : u.toLowerCase()}`;

export const ruleCliffExceedsSpan: RuleModule = {
  meta,
  create(ctx) {
    const { id, severity } = meta;
    return {
      Schedule(node, path) {
        const { type, length, occurrences, cliff } = node.periodicity;
        if (!cliff) return;

        const off = startRelativeOffset(cliff);
        // A cross-unit cliff (e.g. a days cliff over a months grid) can't be
        // compared to the span without a calendar anchor, which the linter
        // doesn't have. Leave it to the evaluator.
        if (!off || off.unit !== type) return;

        // The grid runs occurrences × period in the period's own unit; its last
        // tranche date sits exactly at the span. A cliff at or before that lands
        // on (or inside) the grid. Only a cliff past it lumps the whole segment
        // onto a date after the grid has ended.
        const span = occurrences * length;
        if (off.value <= span) return;

        ctx.report({
          ruleId: id,
          message: `CLIFF ${unit(type, off.value)} exceeds this segment's grid span of ${unit(type, span)} (${occurrences} × ${length}); the whole segment lumps onto a date after its grid ends.`,
          severity,
          path: path.concat("periodicity", "cliff"),
        });
      },
    };
  },
};
