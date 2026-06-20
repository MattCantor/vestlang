export {
  stringify,
  stringifyProgram,
  stringifyStatement,
  stringifyVestingNodeExpr,
} from "./stringify.js";
export { toDoc } from "./to-doc.js";
export type { Doc } from "./doc.js";
// The AST validator, factored so the evaluator's boundary guard can reuse the one
// traversal rather than carry a second copy of the well-formedness rules. render
// itself only needs `assertPrintable`; the collectors and formatter are for the
// evaluator, which voices its own message over the shared error list.
export {
  collectAstErrors,
  collectNodeExprErrors,
  formatAstErrors,
  assertPrintable,
  type AstError,
} from "./validate.js";
