import { Bound, Window } from "./normalized.js";

export const hasStart = (w: Window): w is { start: Bound } => !!w.start;
export const hasEnd = (w: Window): w is { end: Bound } => !!w.end;
export const isRange = (w: Window): w is { start: Bound, end: Bound } => !!w.start && !!w.end;
