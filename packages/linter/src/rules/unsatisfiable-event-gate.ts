import { analyzeSameAnchorGate } from "@vestlang/primitives";
import { RuleModule } from "../types.js";

const meta = {
  id: "unsatisfiable-event-gate",
  description:
    "A BEFORE/AFTER gate that pins both sides to the same non-date anchor (an event, or grantDate/vestingStart) can be impossible no matter when the event fires; such a gate can never be satisfied, so the gated node can never resolve.",
  recommended: true,
  severity: "error" as const,
};

// The event analog of `unsatisfiable-date-window`. That rule reasons over fixed
// dates; this one reasons over the *shared anchor* that cancels out of a
// BEFORE/AFTER comparison — `EVENT ipo STRICTLY AFTER EVENT ipo`, or a pair of
// bounds against the same event that leaves no room between them. The analysis is
// firing-invariant (true regardless of when anything fires) and only ever
// under-reports, so a clean result is not a promise the gate is satisfiable.
export const ruleUnsatisfiableEventGate: RuleModule = {
  meta,
  create(ctx) {
    const { id, severity } = meta;
    return {
      // Every gated node surfaces here — start, cliff, or a selector arm — so the
      // one hook covers them all, exactly as the date rule does.
      NODE(node, path) {
        if (!node.condition) return;
        const { reflexive, emptyWindow } = analyzeSameAnchorGate(node);

        // A reflexive contradiction is about the node's own anchor comparing
        // against itself, so it points at the node; report it there.
        if (reflexive) {
          ctx.report({
            ruleId: id,
            severity,
            path,
            message:
              "this gate compares the node's own anchor against itself and can never be satisfied, whenever the event fires",
          });
        }

        // An empty window is a property of the constraints taken together, so it
        // points at the condition — matching where the date rule reports its own
        // empty window.
        if (emptyWindow) {
          ctx.report({
            ruleId: id,
            severity,
            path: path.concat("condition"),
            message:
              "this gate's bounds against a single event leave no room between them; no firing can satisfy it",
          });
        }
      },
    };
  },
};
