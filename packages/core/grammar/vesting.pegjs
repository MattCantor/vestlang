Start
  = _ s:statement _ { return s; }

statement
  = "vest" __ amount:integer _ condition:condition? _ schedule:schedule? {
    return {
      type: "vest",
      amount,
      condition,
      schedule
    };
  }

condition
  = "if" __ event:identifier { return { type: "condition", event }; }

schedule
  = "over" __ duration:duration __ "every" __ cadence:cadence _ start:startClause? {
    return {
      type: "schedule",
      duration,
      cadence,
      start: start ?? { type: "vcd", value: "grant_date" }
    };
  }

startClause
  = "starting" __ startValue:(identifier / dateLiteral) {
    return { type: "vcd", value: startValue };
  }

duration
  = amount:integer __ unit:timeUnit { return { amount, unit }; }

cadence
  = amount:integer __ unit:timeUnit { return { amount, unit }; }

timeUnit
  = "day" "s"? { return "days"; }
  / "month" "s"? { return "months"; }

digit = [0-9]

digits4 = d1:digit d2:digit d3:digit d4:digit { return d1 + d2 + d3 + d4; }
digits2 = d1:digit d2:digit { return d1 + d2; }

dateLiteral
  = year:digits4 "-" month:digits2 "-" day:digits2 {
      return `${year}-${month}-${day}`;
    }

integer
  = digits:[0-9]+ { return parseInt(digits.join(""), 10); }

identifier
  = first:[a-zA-Z_] rest:[a-zA-Z0-9_]* {
      return first + rest.join("");
    }

_  = [ \t\n\r]*
__ = [ \t\n\r]+ 
