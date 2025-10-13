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
    if (d < 0) { return n = -n; d = -d; }
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
  function mkCondition(type, condition) {
    return {
      type,
      condition
    }
  }
  const SYSTEM_EVENTS = new Set(["grantdate", "vestingstart"]);
  function isSystemEvent(name) {
    return SYSTEM_EVENTS.has(name.toLowerCase())
  }
  function mkGrantDateNode(offset) {
    return {
      type: "BARE",
      base: { type: "EVENT", value: "grantDate" },
      offsets: [offset],
      conditions: null
    };
  }
  function isDuration(x) {
    return x && typeof x === "object" && x.type === "DURATION";
  }
  function mkVestingStartNode(offset) {
    return {
      type: "BARE",
      base: { type: "EVENT", value: "vestingStart"},
      offsets: [offset],
      conditions: null
    }
  }
}

Start
  = _ x:(list:VestStmtList { return list; }
  / stmt:VestStmt { return stmt; }
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
