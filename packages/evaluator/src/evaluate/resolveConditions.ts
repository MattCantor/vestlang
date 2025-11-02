// import type {
//   Condition,
//   EvaluationContext,
//   NodeMeta,
//   VestingNode,
//   OCTDate,
//   Offsets,
//   Blocker,
//   ResolvedNode,
//   UnresolvedNode,
//   ImpossibleBlocker,
//   AtomCondition,
//   ConstrainedVestingNode,
// } from "@vestlang/types";
// import { addDays, addMonthsRule, eq, gt, lt } from "./time.js";
//
// /* ------------------------
//  * Helpers
//  * ------------------------ */
//
// function createBlockerCondition(
//   vestingNode: VestingNode & { constraints: AtomCondition },
// ): Omit<VestingNode, "type"> {
//   const { type, ...rest } = vestingNode;
//   return rest;
// }
//
// /* ------------------------
//  * A Before B
//  *
//  * |              | B Impossible | B Unresolved | B Resolved |
//  * |--------------|--------------|--------------|------------|
//  * | A Unresolved | Unresolved   | Unresolved   | Test       |
//  * | A Resolved   | Resolved     | Resolved     | Test       |
//  *
//  * A After B
//  *
//  * |              | B Impossible | B Unresolved | B Resolved |
//  * |--------------|--------------|--------------|------------|
//  * | A Unresolved | Impossible   | Unresolved   | Test       |
//  * | A Resolved   | Impossible   | Impossible   | Test       |
//
//  * ------------------------ */
//
// /** BEFORE/AFTER with unresolved semantics + strictness */
// function evaluateConstraint(
//   resSubject: ResolvedNode | UnresolvedNode,
//   resConstraintBase: NodeMeta,
//   vestingNode: VestingNode & { constraints: AtomCondition },
//   ctx: EvaluationContext,
// ): Blocker[] | undefined {
//   const impossible = (): ImpossibleBlocker => ({
//     type: "IMPOSSIBLE_CONDITION",
//     condition: createBlockerCondition(vestingNode),
//   });
//
//   console.log("resolveConstraint - resSubject:", JSON.stringify(resSubject));
//   console.log(
//     "resolveConstraint - resConstraintBase:",
//     JSON.stringify(resConstraintBase),
//   );
//   console.log("resolveConstraint - vestingNode:", JSON.stringify(vestingNode));
//   console.log("resolveConstraint - ctx:", JSON.stringify(ctx));
//
//   const condition = vestingNode.constraints;
//   switch (condition.constraint.type) {
//     case "BEFORE":
//       switch (resSubject.type) {
//         case "UNRESOLVED":
//           // A is unresolved and B is resolved
//           if (resConstraintBase.type == "RESOLVED") {
//             // Unresolved if B's date has not yet occurrred
//             const constraintBaseDate = resConstraintBase.date;
//             if (gt(constraintBaseDate, ctx.asOf))
//               return [
//                 ...resSubject.blockers,
//                 {
//                   type: "UNRESOLVED_CONDITION",
//                   condition: createBlockerCondition(vestingNode),
//                 },
//               ];
//
//             // Impossible if B's date has occurred
//             return [impossible()];
//           }
//           // A and B are unresolved
//           return [
//             ...resSubject.blockers,
//             ...resConstraintBase.blockers,
//             {
//               type: "UNRESOLVED_CONDITION",
//               condition: createBlockerCondition(vestingNode),
//             },
//           ];
//
//         case "RESOLVED":
//           // A and B are resolved
//           if (resConstraintBase.type === "RESOLVED") {
//             const subjectDate = resSubject.date;
//             const constraintBaseDate = resConstraintBase.date;
//
//             // console.log("resolveConstraint - subjectDate:", subjectDate);
//             // console.log(
//             //   "resolveConstraint - constraintBaseDate:",
//             //   constraintBaseDate,
//             // );
//
//             // Impossible if A is not before B
//             const constraintFailed = condition.constraint.strict
//               ? gt(subjectDate, constraintBaseDate) ||
//                 eq(subjectDate, constraintBaseDate)
//               : gt(subjectDate, constraintBaseDate);
//
//             if (constraintFailed) return [impossible()];
//           }
//
//           // A is resolved and B is unresolved
//           // return undefined indicating no blockers
//           return undefined;
//       }
//
//     case "AFTER":
//       switch (resSubject.type) {
//         case "UNRESOLVED":
//           // A is unresolved and B is impossible
//           if (resConstraintBase.type === "IMPOSSIBLE") return [impossible()];
//
//           // A is uresolved and B is resolved
//           if (resConstraintBase.type === "RESOLVED") {
//             // Unresolved if B'd date has not yet occurred
//             const constraintBaseDate = resConstraintBase.date;
//             if (gt(constraintBaseDate, ctx.asOf))
//               return [
//                 ...resSubject.blockers,
//                 {
//                   type: "UNRESOLVED_CONDITION",
//                   condition: createBlockerCondition(vestingNode),
//                 },
//               ];
//
//             // Impossible if B's date has occurred
//             return [impossible()];
//           }
//
//           // A and B are unresolved
//           return [
//             ...resSubject.blockers,
//             ...resConstraintBase.blockers,
//             {
//               type: "UNRESOLVED_CONDITION",
//               condition: createBlockerCondition(vestingNode),
//             },
//           ];
//
//         case "RESOLVED":
//           switch (resConstraintBase.type) {
//             case "IMPOSSIBLE":
//             case "UNRESOLVED":
//               return [impossible()];
//
//             case "RESOLVED":
//               const subjectDate = resSubject.date;
//               const constraintBaseDate = resConstraintBase.date;
//
//               // The constraint failed if A not after B
//               const constraintFailed = condition.constraint.strict
//                 ? lt(subjectDate, constraintBaseDate) ||
//                   eq(subjectDate, constraintBaseDate)
//                 : lt(subjectDate, constraintBaseDate);
//
//               if (constraintFailed) return [impossible()];
//           }
//       }
//   }
//   return undefined;
// }
//
// function allImpossibleBlockers(x: any[]): x is ImpossibleBlocker[] {
//   return (
//     !!x &&
//     typeof x === "object" &&
//     x.every((blocker) => blocker.type.split("_")[0] === "IMPOSSIBLE")
//   );
// }
//
// /** Resolve Node that is not a selector */
// export function evaluateVestingNode(
//   node: VestingNode,
//   ctx: EvaluationContext,
// ): NodeMeta {
//   // Resolve the vesting node base
//   const resBase = evaluateVestingBase(node, ctx);
//
//   // Return the resolved vesting node base if there are no constraints
//   if (!node.constraints) return resBase;
//
//   // Resolve constraints
//   const blockers = evaluateConstrainedVestingNode(
//     node as ConstrainedVestingNode,
//     resBase,
//     node.constraints,
//     ctx,
//   );
//
//   // Return the resolved vesting node base if all constraints succeeded
//   if (!blockers) return resBase;
//
//   // Compile and return a new Node
//   if (allImpossibleBlockers(blockers)) {
//     return {
//       type: "IMPOSSIBLE",
//       blockers,
//     };
//   }
//   return {
//     type: "UNRESOLVED",
//     blockers,
//   };
// }
//
// function evaluateVestingBase(
//   node: VestingNode,
//   ctx: EvaluationContext,
// ): ResolvedNode | UnresolvedNode {
//   switch (node.base.type) {
//     case "DATE":
//       const offsetDate = applyOffsets(node.base.value, node.offsets, ctx);
//       const notResolved = gt(offsetDate, ctx.asOf);
//       return notResolved
//         ? {
//             type: "UNRESOLVED",
//             blockers: [{ type: "DATE_NOT_YET_OCCURRED", date: offsetDate }],
//           }
//         : {
//             type: "RESOLVED",
//             date: applyOffsets(node.base.value, node.offsets, ctx),
//           };
//     case "EVENT":
//       const eventDate = ctx.events[node.base.value];
//       return eventDate
//         ? { type: "RESOLVED", date: applyOffsets(eventDate, node.offsets, ctx) }
//         : {
//             type: "UNRESOLVED",
//             blockers: [
//               {
//                 type: "EVENT_NOT_YET_OCCURRED",
//                 event: node.base.value,
//               },
//             ],
//           };
//   }
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
// function evaluateConstrainedVestingNode<T extends Condition>(
//   node: ConstrainedVestingNode,
//   resSubject: ResolvedNode | UnresolvedNode,
//   condition: T,
//   ctx: EvaluationContext,
// ): Blocker[] | undefined {
//   switch (condition.type) {
//     case "ATOM":
//       const resConstraintBase = evaluateVestingNode(
//         condition.constraint.base,
//         ctx,
//       );
//       return evaluateConstraint(
//         resSubject,
//         resConstraintBase,
//         node as VestingNode & { constraints: AtomCondition },
//         ctx,
//       );
//     case "AND":
//       return condition.items.reduce((acc, current) => {
//         const results = evaluateConstrainedVestingNode(
//           node,
//           resSubject,
//           current,
//           ctx,
//         );
//         if (!results) return acc;
//         acc.push(...results);
//         return acc;
//       }, [] as Blocker[]);
//     case "OR":
//       let anyUnblocked: boolean = false;
//       const blockers: Blocker[] = [];
//       for (const c of condition.items) {
//         const results = evaluateConstrainedVestingNode(
//           node,
//           resSubject,
//           c,
//           ctx,
//         );
//         if (!results) {
//           anyUnblocked = true;
//           continue;
//         }
//         blockers.push(...results);
//       }
//       if (anyUnblocked) return undefined;
//       return blockers;
//   }
// }
