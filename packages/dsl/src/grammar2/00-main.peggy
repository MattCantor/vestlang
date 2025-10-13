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
  function mkQuantity(q) {
    return { type: "QUANTITY", value: q };
  }
  function mkPortion(n, d) {
    // keep denominator positive, move sign to numerator if ever needed
    if (d < 0) { return n = -n; d = -d; }
    return { type: "PORTION", numerator: n, denominator: d };
  }
  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1;
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
      const amt = a ?? mkPortion(1, 1); // default 100%
      return { amount: amt, schedule: s };
    }
