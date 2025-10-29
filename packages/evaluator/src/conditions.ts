// import {
//   Blocker,
//   Condition,
//   ConstraintTag,
//   OCTDate,
//   VestingNode,
//   EvaluationContext,
// } from "@vestlang/types";
// import { lt, gt, eq } from "./time.js";
// import { resolveConcreteNode, resolveNodeBaseDate } from "./resolve.js";
//
// /** BEFORE/AFTER with unresolved semantics + strictness */
// function compareDates(
//   subjectDate: OCTDate | undefined,
//   constraintDate: OCTDate | undefined,
//   constraintType: ConstraintTag,
//   strict: boolean,
// ):
//   | Extract<Blocker, { type: "CONSTRAINT_FALSE_BUT_SATISFIABLE" }>["type"]
//   | Extract<Blocker, { type: "CONSTRAINT_FALSE_NOT_SATISFIABLE" }>["type"]
//   | undefined {
//   const A = !!subjectDate;
//   const B = !!constraintDate;
//
//   if (!A && !B) return "CONSTRAINT_FALSE_BUT_SATISFIABLE";
//
//   switch (constraintType) {
//     case "BEFORE":
//       if (A && !B) return "CONSTRAINT_FALSE_BUT_SATISFIABLE";
//       if (!A && B) return "CONSTRAINT_FALSE_NOT_SATISFIABLE";
//       return strict
//         ? lt(subjectDate!, constraintDate!)
//           ? undefined
//           : "CONSTRAINT_FALSE_NOT_SATISFIABLE"
//         : lt(subjectDate!, constraintDate!) || eq(subjectDate!, constraintDate!)
//           ? undefined
//           : "CONSTRAINT_FALSE_NOT_SATISFIABLE";
//     case "AFTER":
//       if (A && !B) return "CONSTRAINT_FALSE_NOT_SATISFIABLE";
//       if (!A && B) return "CONSTRAINT_FALSE_BUT_SATISFIABLE";
//       return strict
//         ? gt(subjectDate!, constraintDate!)
//           ? undefined
//           : "CONSTRAINT_FALSE_NOT_SATISFIABLE"
//         : gt(subjectDate!, constraintDate!) || eq(subjectDate!, constraintDate!)
//           ? undefined
//           : "CONSTRAINT_FALSE_NOT_SATISFIABLE";
//   }
// }
//
// /**
//  * Evaluate a Condition tree with respect to a SUBJECT node.
//  * - Left side (A): SUBJECT.base date (no offsets, no subject constraints)
//  * - Right side (B): constraint.base node with its own constraints + offsets
//  */
// export function evalConditionWithSubject(
//   condition: Condition,
//   subject: VestingNode,
//   ctx: EvaluationContext,
// ): Blocker[] {
//   switch (condition.type) {
//     case "ATOM": {
//       const resolvedSubject = resolveNodeBaseDate(subject, ctx);
//       const constraintBaseState = resolveConcreteNode(
//         condition.constraint.base,
//         ctx,
//       );
//       const subjectDate =
//         resolvedSubject.state === "RESOLVED" ? resolvedSubject.date : undefined;
//       const constraintDate =
//         constraintBaseState.state === "RESOLVED"
//           ? constraintBaseState.date
//           : undefined;
//
//       const compareResult = compareDates(
//         subjectDate,
//         constraintDate,
//         condition.constraint.type,
//         condition.constraint.strict,
//       );
//
//       if (!compareResult) return [] as Blocker[];
//
//       return [
//         {
//           type: compareResult,
//           subject,
//           condition,
//         },
//       ];
//     }
//     case "AND":
//       // return condition.items.every((item) =>
//       //   evalConditionWithSubject(item, subject, ctx),
//       // );
//       const andBlockers = condition.items.reduce((acc, current) => {
//         const result = evalConditionWithSubject(current, subject, ctx);
//         if (result.length !== 0) acc.push(...result);
//         return acc;
//       }, [] as Blocker[]);
//
//       return andBlockers;
//     // return cond.items.every((i) => evalConditionWithSubject(i, subject, ctx)) ? { result: true } : { result: false; blockers: };
//     case "OR":
//       const orBlockers = condition.items.reduce((acc, current) => {
//         const result = evalConditionWithSubject(current, subject, ctx);
//         if (result.length !== 0) acc.push(...result);
//         return acc;
//       }, [] as Blocker[]);
//       if (orBlockers.length === condition.items.length) return orBlockers;
//       return [] as Blocker[];
//     // return condition.items.some((i) =>
//     //   evalConditionWithSubject(i, subject, ctx),
//     // );
//   }
// }
