import { DateGate, EventAtom, QualifiedAnchor } from "@vestlang/dsl"
import { DateAnchor, EventAnchor } from "./types/shared.js"
import { OCTDate } from "./oct-types.js"
import { Window } from "./types/normalized.js"
export function createDateAnchor(anchor: DateGate): DateAnchor {
    return {
        type: "Date",
        value: anchor.iso as OCTDate
    }
  }

export function createEventAnchor(anchor: EventAtom): EventAnchor {
  return {
      type: "Event",
      value: anchor.name
  }
}

export function createWindow(anchor: QualifiedAnchor): Window {
  return undefined
}
