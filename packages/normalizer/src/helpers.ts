import { Anchor } from "@vestlang/dsl";
import { Window } from "./types/normalized.js"

/* -------------
 * Window
* ------------- */

export const Start = (at: Anchor, inclusive = true): Window => ({
    start: { at, inclusive }
})

export const End = (at: Anchor, inclusive = true): Window => ({
    end: { at, inclusive }
})

export const Range = (a: Anchor, ai = true, b: Anchor, bi = true): Window => ({
    start: { at: a, inclusive: ai },
    end: { at: b, inclusive: bi }
})

export const Empty: Window = {};
