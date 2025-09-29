// src/types.ts
import type {
  Statement as VestStatement,
  Expr,
  Schedule,
  EarlierOfSchedules,
  LaterOfSchedules,
  Duration,
  ZeroGate,
  QualifiedAnchor,
  DateGate,
  EventAtom,
  FromTerm,
  CliffTerm,
} from "@vestlang/dsl";

// Our root node so Prettier has a typed entry point
export interface Program {
  type: "Program";
  body: VestStatement[]; // your original shape; no extra `type` required here
}

export type AstNode =
  | Program
  | Expr
  | Schedule
  | EarlierOfSchedules
  | LaterOfSchedules
  | Duration
  | ZeroGate
  | QualifiedAnchor
  | DateGate
  | EventAtom
  | FromTerm
  | CliffTerm
  | { type: string; [k: string]: any };

export type ParseResult = Program;

// Prettier Doc type (kept loose here)
export type Doc = any;
