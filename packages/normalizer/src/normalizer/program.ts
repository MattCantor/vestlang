import {
  ASTExpr,
  ASTSchedule,
  ASTStatement,
  ASTCliffExpr,
  EarlierOfASTExpr,
  ASTFromExpr,
  LaterOfASTExpr,
  ASTNode,
} from "@vestlang/dsl";
import { normalizeVestingNode } from "./core.js";
import { dedupe, stableKey } from "./utils.js";
import {
  EarlierOfSchedule,
  EarlierOfVestingNode,
  LaterOfSchedule,
  LaterOfVestingNode,
  Schedule,
  Statement,
  VestingNode,
} from "../types/index.js";

/* ------------------------
 * Guards
 * ------------------------ */

/** Type guard for Schedules */
export function isSchedule(e: ASTExpr): e is ASTSchedule {
  return !!e && typeof e === "object" && e.type === "SINGLETON";
}

/** Type guard for selectors (EARLIER_OF/LATER_OF) */
export function isSelector(x: any): x is EarlierOfASTExpr | LaterOfASTExpr {
  return (
    !!x &&
    typeof x === "object" &&
    (x.type === "LATER_OF" || x.type === "EARLIER_OF")
  );
}

/** Type guard for vesting nodes */
export function isVestingNode(x: any): x is ASTNode {
  return (
    !!x &&
    typeof x === "object" &&
    (x.type === "BARE" || x.type === "CONSTRAINED")
  );
}

/* ------------------------
 * Orchestration
 * ------------------------ */

/**
 * Normalize a single statement
 * `amount` comes already canonical from the grammar
 */
export function normalizeStatement(s: ASTStatement): Statement {
  return {
    amount: s.amount,
    expr: normalizeExpr(s.expr),
  };
}

/**
 * Normalize an ASTExpr
 * - SINGLETON schedules
 * - Selectors (EARLIER_OF/LATER_OF) across expressions
 */
function normalizeExpr(
  e: ASTExpr,
): Schedule | LaterOfSchedule | EarlierOfSchedule {
  if (isSchedule(e)) {
    return normalizeSchedule(e);
  }

  if (isSelector(e)) {
    return normalizeExprSelector(e);
  }

  throw new Error(`normalizeExpr: unexpected expr type ${(e as any)?.type}`);
}

/**
 * Normalize a schedule
 * - Normaizes `vesting_start` and optional `cliff`
 * - Periodicity comes already canonical from the grammar
 */
function normalizeSchedule(s: ASTSchedule): Schedule {
  const vesting_start = normalizeFromOrCliff(s.vesting_start);

  const cliff =
    (s as any).cliff !== undefined
      ? normalizeFromOrCliff((s as any).cliff)
      : undefined;

  const periodicity = { ...s.periodicity };

  const out: any = { ...s, vesting_start, periodicity };
  if (cliff !== undefined) out.cliff = cliff;
  return out;
}

/**
 * Normalizes a `FROM` or `CLIFF` payload, which may be a vesting node or a selector.
 */
function normalizeFromOrCliff(
  x: ASTCliffExpr | ASTFromExpr,
): VestingNode | LaterOfVestingNode | EarlierOfVestingNode {
  if (isVestingNode(x)) return normalizeVestingNode(x);
  if (isSelector(x)) return normalizeExprSelector(x);
  throw new Error(
    `normalizeFromOrCliff: unexpected expression type ${(x as any)?.type}`,
  );
}

/* ------------------------
 * Selectors
 * ------------------------ */

/**
 * Normalize an expression selector:
 * - Recursively normalizes items
 * - Flattens nested same-op selectors
 * - Sorts and dedupes items for determinism
 */
export function normalizeExprSelector(
  selector: EarlierOfASTExpr | LaterOfASTExpr,
) {
  const tag = selector.type; // EARLIER_OF | LATER_OF

  // Normalize children (nested selecotrs or vesting nodes or schedules
  let items = selector.items.map((item) =>
    isVestingNode(item)
      ? normalizeVestingNode(item)
      : normalizeExpr(item as ASTExpr),
  );

  // Flatten same-op: EARLIER_OF(EARLIER_OF(...), x) -> EARLIER_OF(...)
  items = items.flatMap((item) =>
    isSelector(item) && item.type === tag ? (item as any).items : [item],
  );

  // Sort & dedupe
  items.sort((a, b) => stableKey(a).localeCompare(stableKey(b)));
  items = dedupe(items);

  // Collapse singletons
  if (items.length === 1) return items[0];

  return { type: tag, items } as any;
}
