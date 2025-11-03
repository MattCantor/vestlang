import {
  AndCondition,
  Condition,
  EarlierOfSchedule,
  EarlierOfVestingNode,
  LaterOfSchedule,
  LaterOfVestingNode,
  OrCondition,
  Program,
  Schedule,
  Statement,
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

export type Visitor = Partial<{
  Program: (node: Program) => void;
  Statement: (node: Statement, path: NodePath) => void;
  Schedule: (node: Schedule, path: NodePath) => void;
  ScheduleSelector: (
    node: EarlierOfSchedule | LaterOfSchedule,
    path: NodePath,
  ) => void;
  VestingNode: (node: VestingNode, path: NodePath) => void;
  VestingNodeSelector: (
    node: EarlierOfVestingNode | LaterOfVestingNode,
    path: NodePath,
  ) => void;
  Condition: (node: Condition, path: NodePath) => void;
  AndCondition: (node: AndCondition, path: NodePath) => void;
  OrCondition: (node: OrCondition, path: NodePath) => void;
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
