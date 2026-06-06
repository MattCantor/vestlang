import {
  AndCondition,
  AtomCondition,
  ChainedSchedule,
  Constraint,
  EarlierOfSchedule,
  EarlierOfVestingNode,
  LaterOfSchedule,
  LaterOfVestingNode,
  OrCondition,
  Program,
  Schedule,
  Statement,
  VestingBaseDate,
  VestingBaseEvent,
  VestingNode,
} from "@vestlang/types";

export type NodePath = (string | number)[];

export type LintSeverity = "error" | "warning" | "info";

export interface SourcePosition {
  line: number;
  column: number;
}
export interface SourceLocation {
  start: SourcePosition;
  end: SourcePosition;
}
export interface Diagnostic {
  ruleId: string;
  message: string;
  severity: LintSeverity;
  path: NodePath;
  loc?: SourceLocation;
  codeFrame?: string;
}

export interface LintContext {
  report: (d: Diagnostic) => void;
  stableKey: (x: unknown) => string;
}

// A rule subscribes to node kinds by name. The keys are the AST's `type` tags,
// which are globally unique, so one key picks out exactly one kind of node. The
// linter's driver calls the matching hook on every node it walks — see
// `@vestlang/walk`'s `forEachChild` for the set of kinds and the edges between
// them. `Program` is the one exception: a program is a bare statement array with
// no `type` tag, so the walk never lands on it and the driver calls this hook
// separately, once, with the whole program.
//
// Most rules subscribe to one or two kinds; the full set is listed so a new rule
// can hook anything without touching this type.
export type Visitor = Partial<{
  Program: (node: Program) => void;
  STATEMENT: (node: Statement, path: NodePath) => void;
  SCHEDULE: (node: Schedule | ChainedSchedule, path: NodePath) => void;
  SCHEDULE_EARLIER_OF: (node: EarlierOfSchedule, path: NodePath) => void;
  SCHEDULE_LATER_OF: (node: LaterOfSchedule, path: NodePath) => void;
  NODE: (node: VestingNode, path: NodePath) => void;
  NODE_EARLIER_OF: (node: EarlierOfVestingNode, path: NodePath) => void;
  NODE_LATER_OF: (node: LaterOfVestingNode, path: NodePath) => void;
  ATOM: (node: AtomCondition, path: NodePath) => void;
  AND: (node: AndCondition, path: NodePath) => void;
  OR: (node: OrCondition, path: NodePath) => void;
  BEFORE: (node: Constraint, path: NodePath) => void;
  AFTER: (node: Constraint, path: NodePath) => void;
  DATE: (node: VestingBaseDate, path: NodePath) => void;
  EVENT: (node: VestingBaseEvent, path: NodePath) => void;
}>;

export interface RuleModule {
  meta: {
    id: string;
    description: string;
    recommended?: boolean;
    severity: LintSeverity;
  };
  create: (ctx: LintContext) => Visitor;
}

export interface LintResult {
  diagnostics: Diagnostic[];
}
