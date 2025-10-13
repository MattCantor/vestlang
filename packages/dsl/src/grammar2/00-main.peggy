{
  function mkDuration(value, unit, sign) {
    return { type: "DURATION", value, unit, sign };
  }
  function mkDate(iso) {
    return { type: "DATE", value: iso };
  }
  function mkEvent(name) {
    return { type: "EVENT", value: name };
  }
  function mkAmountAbsolute(n) {
    return { type: "AmountAbsolute", value: n };
  }
  function mkAmountPercent(x) {
    return { type: "AmountPercent", value: x };
  }
  function collect(head, tail) {
    return [head, ...tail.map((t) => t[1])];
  }
  function collectTwoOrMore(head, tail) {
    const arr = collect(head, tail);
    if (arr.length < 2) error("At least two items are required");
    return arr;
  }
  function mkCondition(type, condition) {
    return {
      type,
      condition
    }
  }
}

Start
  = _ a:Amount? _ "VEST"i _ s:ScheduleBlock _ {
      const amt = a ?? mkAmountPercent(1); // default 100%
      return { amount: amt, schedule: s };
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

