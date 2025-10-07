// src/types.ts
import type {
  ASTStatement,
  ASTExpr,
  ASTSchedule,
  EarlierOfASTExpr,
  LaterOfASTExpr,
  Duration,
  ConstrainedAnchor,
  DateAnchor,
  EventAnchor,
  From,
  Cliff,
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
  | EarlierOfASTExpr
  | LaterOfASTExpr
  | Duration
  | ConstrainedAnchor
  | DateAnchor
  | EventAnchor
  | From
  | Cliff
  | { type: string; [k: string]: any };

export type ParseResult = Program;

// export type Doc = any;
export type { Doc } from "prettier";
