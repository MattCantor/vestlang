{
  function mkDuration(value, unit, sign) {
    return { type: "DURATION", value, unit, sign };
  }
  function mkDate(iso) { return { type: "DATE", value: iso };
  }
  function mkEvent(name) { return { type: "EVENT", value: name };
  }
  function mkQuantity(q) { return { type: "QUANTITY", value: q };
  }
  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1;
  }
  function mkPortion(n, d) {
    if (d === 0) throw new SyntaxError("Denominator cannot be 0")
    // keep denominator positive, move sign to numerator if ever needed
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(Math.abs(n), d);
    return { type: "PORTION", numerator: n / g, denominator: d / g };
  }
  
  function collect(head, tail) {
    return [head, ...tail.map((t) => t[1])];
  }
  function collectTwoOrMore(head, tail) {
    const arr = collect(head, tail);
    if (arr.length < 2) throw new SyntaxError("At least two items are required");
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
  const SYSTEM_EVENTS = new Set(["grantdate", "vestingstart"]);
  function isSystemEvent(name) {
    return SYSTEM_EVENTS.has(name.toLowerCase())
  }
  function mkVestingNode(duration, context) {
    return {
      type: "BARE",
      base: { type: "EVENT", value: context === "FROM" ? "grantDate" : "vestingStart"},
      offsets: [duration],
    }
  }
  function coerceToVestingNode(x, context) {
    // Duration -> Vesting Node, depending on context
    if (x && typeof x === "object" && x.type === "DURATION") {
      return mkVestingNode(x, context)
    }
    
    // Pass through vesting nodes
    if (x && (x.type === "BARE" || x.type === "CONSTRAINED")) return x;

    // Recurse into selectors and coerce their items
    if (x && (x.type === "EARLIER_OF" || x.type === "LATER_OF") && Array.isArray(x.items)) {
      return {
        type: x.type,
        items: x.items.map((item) => coerceToVestingNode(item, context))
      }
    }

    error(`${context} must be an anchor (EVENT/DATE), a selector (EARLIER/LATER OF...), or a duration.`)
  }
}

Start
  = _ x:(list:VestStmtList { return list; }
  / stmt:VestStmt { return [stmt]; }
  ) _ EOF { return x; }

VestStmt
  = _ a:Amount? _"VEST"i _ s:ScheduleExpr _ {
      const amt = a ?? mkPortion(1, 1); // default 100%
      return { amount: amt, expr: s };
    }

VestStmtList
  = "[" _ head:VestStmt tail:(CommaSep VestStmt)* _ CommaSep? _ "]" {
    return collectTwoOrMore(head, tail)
  }

EOF = !.
