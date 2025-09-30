import type { FromTerm, DateGate, EventAtom, QualifiedAnchor } from "@vestlang/dsl";
import { DEFAULT_GRANT_ANCHOR } from "./from2.js";
import { OCTDate } from "./oct-types.js";
import { DateAnchor } from "./raw-ast.js";
import { VestingStart, Window } from "./types/normalized.js";
import { isAnchor, assertNever, isQualifiedAnchor, isEarlierOfFrom, isLaterOfFrom } from "./types/raw-ast-guards.js";
import { EventAnchor } from "./types/shared.js";

function normalizeFrom(node: FromTerm | null): VestingStart {
    if (!node) {
        return DEFAULT_GRANT_ANCHOR;
    }

    function createDateAnchor(anchor: DateGate): DateAnchor {
        return {
            type: "Date",
            value: anchor.iso as OCTDate
        };
    }

    function createEventAnchor(anchor: EventAtom): EventAnchor {
        return {
            type: "Event",
            value: anchor.name
        };
    }

    function createWindow(anchor: QualifiedAnchor): Window {
    }

    if (isAnchor(node)) {
        switch (node.type) {
            case "Date":
                return { id: '', anchor: createDateAnchor(node), type: "Unqualified" };
            case "Event":
                return { id: '', anchor: createEventAnchor(node), type: "Unqualified" };
            default:
                return assertNever(node as never, "Unexpected Anchor variant in normalizer");
        }
    }

    if (isQualifiedAnchor(node)) {
        switch (node.base.type) {
            case 'Date':
                return {
                    id: '',
                    anchor: createDateAnchor(node.base),
                    window: {}
                };
            case 'Event':
                return {
                    id: '',
                    anchor: createEventAnchor(node.base),
                    window: {}
                };
            default:
                return assertNever(node as never, "Unexpected Qualified Anchor variant in normalizer");
        }
    }

    if (isEarlierOfFrom(node)) {
    }

    if (isLaterOfFrom(node)) {
    }

    return assertNever(node as never, "Unexpected From variant in normalizer");
}

