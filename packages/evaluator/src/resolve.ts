// import {
//   Blocker,
//   Condition,
//   NodeMeta,
//   OCTDate,
//   Offsets,
//   VestingNode,
//   VestingNodeExpr,
// } from "@vestlang/types";
// import { EvaluationContext } from "./types.js";
// import { evalConditionWithSubject } from "./conditions.js";
// import { addMonthsRule, addDays } from "./time.js";
//
// function resolveConstraints(
//   condition: Condition,
//   subject: VestingNode,
//   ctx: EvaluationContext,
// ): NodeMeta | undefined {
//   const blockers = evalConditionWithSubject(condition, subject, ctx);
//   if (blockers.length !== 0) {
//     if (blockers.some((b) => b.type === "CONSTRAINT_FALSE_NOT_SATISFIABLE")) {
//       return { state: "IMPOSSIBLE" as const, blockers };
//     }
//     return { state: "UNRESOLVED" as const, blockers };
//   }
// }
//
// /**
//  * Resolve a node's BASE date (no offsets).
//  * - If checkConstraints = true, node's own constraints must evaluate true, otherwise treat as unresolved/inactive accordingly.
//  */
// export function resolveNodeBaseDate(
//   node: VestingNode,
//   ctx: EvaluationContext,
// ): NodeMeta {
//   if (node.constraints) {
//     const result = resolveConstraints(node.constraints, node, ctx);
//     if (result) return result;
//   }
//   if (node.base.type === "DATE")
//     return { state: "RESOLVED", date: node.base.value };
//   const eventDate = ctx.events[node.base.value];
//   return eventDate
//     ? { state: "RESOLVED", date: eventDate }
//     : {
//         state: "UNRESOLVED",
//         blockers: [
//           {
//             type: "MISSING_EVENT",
//             event: node.base.value,
//           },
//         ],
//       };
// }
//
// function applyOffsets(
//   base: OCTDate,
//   offsets: Offsets,
//   ctx: EvaluationContext,
// ): OCTDate {
//   let d = base;
//   for (const o of offsets) {
//     d =
//       o.unit === "MONTHS"
//         ? addMonthsRule(d, o.sign === "PLUS" ? o.value : -o.value, ctx)
//         : addDays(d, o.sign === "PLUS" ? o.value : -o.value);
//   }
//   return d;
// }
//
// /** Full node resolution (constraints + base + offsets) */
// export function resolveConcreteNode(
//   node: VestingNode,
//   ctx: EvaluationContext,
// ): NodeMeta {
//   // constraints first
//   if (node.constraints) {
//     const result = resolveConstraints(node.constraints, node, ctx);
//     if (result) return result;
//   }
//
//   const base = resolveNodeBaseDate(node, ctx);
//   switch (base.state) {
//     case "RESOLVED":
//       return {
//         state: "RESOLVED",
//         date: applyOffsets(base.date, node.offsets, ctx),
//       };
//     case "UNRESOLVED":
//     case "IMPOSSIBLE":
//       return {
//         state: base.state,
//         blockers: base.blockers,
//       };
//   }
// }
//
// export function resolveNodeExpr(
//   expr: VestingNodeExpr,
//   ctx: EvaluationContext,
// ): NodeMeta {
//   switch (expr.type) {
//     case "BARE":
//     case "CONSTRAINED":
//       return resolveConcreteNode(expr, ctx);
//
//     case "EARLIER_OF": {
//       let earliest: OCTDate | undefined;
//       let anyResolved = false;
//       let blockers: Blocker[] = [];
//
//       for (const item of expr.items) {
//         const resolved = resolveNodeExpr(item, ctx);
//         if (resolved.state !== "RESOLVED") {
//           blockers.push(...resolved.blockers);
//         } else {
//           anyResolved = true;
//           earliest =
//             !earliest || resolved.date < earliest ? resolved.date : earliest;
//         }
//       }
//
//       return anyResolved && earliest
//         ? { state: "RESOLVED", date: earliest }
//         : { state: "UNRESOLVED", blockers };
//     }
//
//     case "LATER_OF": {
//       let latest: OCTDate | undefined;
//       let anyResolved = false;
//       let blockers: Blocker[] = [];
//
//       for (const item of expr.items) {
//         const resolved = resolveNodeExpr(item, ctx);
//         if (resolved.state !== "RESOLVED") {
//           blockers.push(...resolved.blockers);
//         } else {
//           anyResolved = true;
//           latest = !latest || resolved.date > latest ? resolved.date : latest;
//         }
//       }
//       return anyResolved && latest
//         ? { state: "RESOLVED", date: latest }
//         : { state: "UNRESOLVED", blockers };
//     }
//   }
// }
