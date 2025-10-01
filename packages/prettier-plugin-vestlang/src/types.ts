// src/types.ts
import type {
  ASTStatement,
  ASTExpr,
  ASTSchedule,
  EarlierOfASTSchedules,
  LaterOfASTSchedules,
  Duration,
  QualifiedAnchor,
  DateAnchor,
  EventAnchor,
  FromTerm,
  CliffTerm,
} from "@vestlang/dsl";

// Our root node so Prettier has a typed entry point
export interface Program {
  type: "Program";
  body: ASTStatement[]; // your original shape; no extra `type` required here
}

export type AstNode =
  | Program
  | ASTExpr
  | ASTSchedule
  | EarlierOfASTSchedules
  | LaterOfASTSchedules
  | Duration
  | QualifiedAnchor
  | DateAnchor
  | EventAnchor
  | FromTerm
  | CliffTerm
  | { type: string; [k: string]: any };

export type ParseResult = Program;

// Prettier Doc type (kept loose here)
export type Doc = any;
