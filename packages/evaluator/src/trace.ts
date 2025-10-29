// import { VestingNode, VestingNodeExpr } from "@vestlang/types";
// import { Blocker, EvaluationContext } from "./types.js";
//
// export function analyzeUnresolvedReasons(
//   expr: VestingNodeExpr,
//   ctx: EvaluationContext,
// ): Blocker[] {
//   const out: Blocker[] = [];
//
//   function collectFromNode(n: VestingNode) {
//     // Subject constraints: if false, decide if potentially satisfiable
//     if (n.constraints) {
//       // Evaluate ATOM/AND/OR with subject semantics.
//       // Inspect sub-terms to see if any side is missing events.
//       // If constraints evaluate false and either side references an EVENT with no date, treat as potentially satisfiable.
//       const hasMissing = findMissingEventsInCondition().length > 0;
//       const ok = true; // Placehodler for deeper inspection
//       if (!ok) {
//         out.push(
//           hasMissing
//             ? {
//                 type: "CONSTRAINT_FALSE_BUT_SATISFIABLE",
//                 note: "constraint references unresolved event(s)",
//               }
//             : {
//                 type: "CONSTRAINT_FALSE_NOT_SATISFIABLE",
//                 note: "constraint violated with concrete dates ",
//               },
//         );
//       }
//     }
//
//     // Base EVENT missing?
//     if (n.base.type === "EVENT" && !ctx.events[n.base.value]) {
//       out.push({ type: "MISSING_EVENT", event: n.base.value });
//     }
//   }
//
//   switch (expr.type) {
//     case "BARE":
//     case "CONSTRAINED":
//       collectFromNode(expr);
//       return out;
//     case "EARLIER_OF":
//       // If none of the items resolve now, add UNRESOLVED_SELECTOR and recurse to gather missing events per item
//       // NOTE: Consider collecting per-item blockers for richer detail
//       out.push({ type: "UNRESOLVED_SELECTOR", selector: "EARLIER_OF" });
//       expr.items.forEach((i) => out.push(...analyzeUnresolvedReasons(i, ctx)));
//       return out;
//     case "LATER_OF":
//       // Requires all items resolved.
//       // collect what's missing from each
//       out.push({ type: "UNRESOLVED_SELECTOR", selector: "LATER_OF" });
//       expr.items.forEach((i) => out.push(...analyzeUnresolvedReasons(i, ctx)));
//       return out;
//   }
// }
//
// function findMissingEventsInCondition(): string[] {
//   // for now return []
//   return [];
// }
