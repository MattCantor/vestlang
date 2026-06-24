{{
  import {
    isContingentStartSentinel,
    isValidCalendarDate,
  } from "@vestlang/utils";
}}

{
  function mkDuration(value, unit, sign) {
    return { type: "DURATION", value, unit, sign };
  }
  // Offsets are aggregated per unit and applied months-first, regardless of the
  // order they were written: `+ 20 days + 1 month` and `+ 1 month + 20 days`
  // both normalize to one months term then one days term, so both apply as
  // months-then-days. This is deliberate and consistent everywhere — the same
  // rule runs on every anchor — and it round-trips (the stringifier emits the
  // normalized pair, which re-parses to itself). Calendar month math isn't
  // commutative with day math, so authored order is not preserved here.
  function normalizeOffsets(offs) {
    if (!offs || offs.length === 0) return [];

    let months = 0, days = 0;

    for (const o of offs) {
      const value = Math.abs(o.value);
      const signed = o.sign === "MINUS" ? -value : value;
      if (o.unit === "MONTHS") { months += signed }
      else if (o.unit === "DAYS") { days += signed }
      else { throw new SyntaxError(`Unknown offset type ${o.unit}`) }
    }

    const offsets = [];
    if (months !== 0) offsets.push(mkDuration(Math.abs(months), "MONTHS", months < 0 ? "MINUS" : "PLUS"))
    if (days !== 0) offsets.push(mkDuration(Math.abs(days), "DAYS", days < 0 ? "MINUS" : "PLUS"))

    return offsets
  }
  function mkDate(iso) { return { type: "DATE", value: iso };
  }
  function mkEvent(name) { return { type: "EVENT", value: name };
  }
  // System anchors are their own base tags, distinct from genuine events.
  function mkGrantDate() { return { type: "GRANT_DATE" }; }
  function mkVestingStart() { return { type: "VESTING_START" }; }
  function mkQuantity(q) { return { type: "QUANTITY", value: q };
  }
  // A literal whose magnitude can't be held exactly as a number (past 2^53−1) is
  // rejected at parse, not silently rounded. Shared by every numeric-literal site —
  // the Integer rule (share counts, fraction terms, durations) checks the digit
  // string, PortionDecimal checks the implied 10^n denominator — so the threshold and
  // message live in one place. The generic wording covers all of them.
  function assertSafeInteger(big) {
    if (big > 9007199254740991n) {
      error("integer literal exceeds the safe integer range (maximum 9007199254740991)");
    }
  }
  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1;
  }
  function mkPortion(n, d) {
    if (d === 0) error("Denominator cannot be 0")
    // keep denominator positive, move sign to numerator if ever needed
    if (d < 0) { n = -n; d = -d; }
    // Same [0,1] bound the decimal portion enforces — a fraction over 1 (or below 0)
    // is just as much an out-of-range portion as 1.5 is.
    if (n < 0 || n > d) {
      error("Fraction portion must be between 0 and 1 inclusive");
    }
    const g = gcd(Math.abs(n), d);
    return { type: "PORTION", numerator: n / g, denominator: d / g };
  }
  
  function collect(head, tail) {
    return [head, ...tail.map((t) => t[1])];
  }
  function collectTwoOrMore(head, tail) {
    const arr = collect(head, tail);
    if (arr.length < 2) error("At least two items are required");
    return arr;
  }
  function mkBool(op, items) {
    const OP = op.toUpperCase();
    // Flatten nested same-op nodes: AND(AND(a, b), c) -> AND(a,b,c)
    const flat = [];
    for (const item of items) {
      if (item && item.type === OP && Array.isArray(item.items)) {
        flat.push(...item.items);
      } else {
        flat.push(item);
      }
    }

    // Enforce arity >= 2
    if (flat.length === 1) return flat[0];
    if (flat.length < 2) throw new SyntaxError(
      `${OP} requires at least two items`
    )
    return { type: OP, items: flat }
  }
  // Tag a node that came from explicit grouping — parentheses or AND(...)/OR(...).
  // The infix OrExpr reads this to tell a deliberately-grouped AND operand from a
  // bare one. Transient: the normalizer strips it.
  function markGrouped(node) {
    if (node && typeof node === "object") node.grouped = true;
    return node;
  }
  // Flag a bare mixed infix `a OR b AND c`. AND binds tighter than OR, so this
  // groups as OR(a, AND(b,c)) with nothing in the source to show it. Detect it on
  // the OR whose operands include an un-grouped AND, and stash the OR's span so
  // the normalizer can surface how it grouped. `operands` are the raw AndExpr
  // results, NOT node.items — mkBool may have flattened a grouped child OR in,
  // whose AND would otherwise read as top-level mixing.
  function flagMixedInfix(node, operands, loc) {
    if (
      node && node.type === "OR" &&
      operands.some((op) => op && op.type === "AND" && !op.grouped)
    ) {
      node.mixedInfix = loc;
    }
    return node;
  }
  // True if `node` carries the given system-anchor base anywhere — directly, or
  // inside a selector's arms. Lets FROM/CLIFF reject a forbidden anchor smuggled
  // through EARLIER OF / LATER OF, not just at the top level.
  function hasSystemAnchor(node, anchor) {
    if (!node || typeof node !== "object") return false;
    if (node.type === "NODE") return node.base && node.base.type === anchor;
    if (node.type === "NODE_EARLIER_OF" || node.type === "NODE_LATER_OF") {
      return Array.isArray(node.items)
        && node.items.some((item) => hasSystemAnchor(item, anchor));
    }
    return false;
  }
  // True if any BEFORE/AFTER gate hanging off `node` references vestingStart.
  // On a FROM start this is circular: the gate constrains the very start it
  // defines, and vestingStart isn't known yet while that start resolves, so the
  // gate can never settle. We look only at gate *conditions* here — the anchor
  // base is hasSystemAnchor's territory — which is what keeps a bare
  // `FROM vestingStart` on the anchor message instead of this one.
  //
  // Two mutually-recursive walks over the raw (pre-normalize) parse shape:
  // nodeGateRefsVestingStart descends node forms to find a gate, and
  // conditionRefsVestingStart walks a gate's boolean/atom tree. This duplicates
  // what the `walk` package does on the normalized shape, but the peggy prelude
  // runs at parse time and can't import it, and the raw shape differs (an atom's
  // reference lives inline at `constraint.base`). Keep the two in step if the
  // parse-time Condition shape gains a node type.
  function nodeGateRefsVestingStart(node) {
    if (!node || typeof node !== "object") return false;
    // A plain node carries at most one gate, in `.condition`. The node's own
    // `.base` is the anchor — not our concern.
    if (node.type === "NODE") {
      return node.condition
        ? conditionRefsVestingStart(node.condition)
        : false;
    }
    // A selector sits at the anchor; each arm is itself a node that can carry
    // its own gate. Reject if any arm's gate references vestingStart — at parse
    // time there's no "chosen" arm.
    if (node.type === "NODE_EARLIER_OF" || node.type === "NODE_LATER_OF") {
      return Array.isArray(node.items)
        && node.items.some(nodeGateRefsVestingStart);
    }
    return false;
  }
  function conditionRefsVestingStart(cond) {
    if (!cond || typeof cond !== "object") return false;
    // A leaf comparison: `BEFORE/AFTER <node>`. The compared-against node is the
    // gate reference, and it can itself carry a nested gate (`a AFTER b AFTER
    // vestingStart`), so check the base's tag and recurse into its own gate.
    if (cond.type === "ATOM") {
      const base = cond.constraint && cond.constraint.base;
      if (!base || typeof base !== "object") return false;
      if (base.base && base.base.type === "VESTING_START") return true;
      return nodeGateRefsVestingStart(base);
    }
    // The only boolean tags (see mkBool); nesting like OR(…, AND(…)) is possible.
    if (cond.type === "AND" || cond.type === "OR") {
      return Array.isArray(cond.items)
        && cond.items.some(conditionRefsVestingStart);
    }
    return false;
  }
}

Start
  = _ p:Program _ EOF { return p; }

// A program is one or more parallel components joined by PLUS. Each component is
// a chain of one or more segments joined by THEN. We flatten the whole thing to
// a single statement list: a chain contributes its head followed by its tails,
// and PLUS just concatenates the components. The THEN tails carry a `chained`
// flag so a later pass can tell where one component ends and the next begins.
Program
  = head:Chain tail:(_ "PLUS"i _ c:Chain { return c; })* {
      return [head, ...tail].flat();
    }

Chain
  = head:VestStmt tail:(_ "THEN"i _ t:VestTail { return t; })* {
      return [head, ...tail];
    }

VestStmt
  = _ a:Amount? _"VEST"i _ s:ScheduleExpr _ {
      const amt = a ?? mkPortion(1, 1); // default 100%
      return { type: "STATEMENT", amount: amt, expr: s };
    }

EOF = !.
