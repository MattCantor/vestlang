{
  function mkDuration(value, unit) {
    return { type: "Duration", value, unit };
  }
  function mkDate(iso) {
    return { type: "Date", value: iso };
  }
  function mkEvent(name) {
    return { type: "Event", value: name };
  }
  function mkAmountAbsolute(n) {
    return { type: "AmountAbsolute", value: n };
  }
  function mkAmountPercent(x) {
    return { type: "AmountPercent", value: x };
  }
  function mkConstrained(base, constraints) {
    return constraints && constraints.length
      ? { type: "Constrained", base, constraints }
      : base;
  }
  function collect(head, tail) {
    return [head, ...tail.map((t) => t[1])];
  }
  function collectTwoOrMore(head, tail) {
    const arr = collect(head, tail);
    if (arr.length < 2) error("At least two items are required");
    return arr;
  }
}

Start
  = _ a:Amount? _ "VEST"i _ e:Expr _ {
      const amt = a ?? mkAmountPercent(1); // default 100%
      return { amount: amt, expr: e };
    }

Amount
  // Any decimal in [0,1] is a percent
  = x:Decimal {
      if (x < 0 || x > 1) {
        error("Decimal amount must be between 0 and 1 inclusive");
      }
      return mkAmountPercent(x);
    }
  / n:Integer { return mkAmountAbsolute(n); }

Expr
  = s:ScheduleBlock { return s; }
  / "EARLIER"i _ "OF"i _ "(" _ xs:ExprListTwoOrMore _ ")" {
      return { type: "EarlierOf", items: xs };
    }
  / "LATER"i _ "OF"i _ "(" _ xs:ExprListTwoOrMore _ ")" {
      return { type: "LaterOf", items: xs };
    }

ExprListTwoOrMore
  = head:Expr tail:(CommaSep Expr)* { return collectTwoOrMore(head, tail); }
