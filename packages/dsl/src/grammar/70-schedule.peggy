From = "FROM"i _ a:(VestingNode / GateExpr) {
  if (a.type === "SINGLETON" && a.base.type === "EVENT" && a.base.value === "vestingStart") {
    throw new SyntaxError('vestingStart is a reserved system event that cannot be used in a `FROM` statement. Pick a different event name.')
  }
  return a
}

Cliff = "CLIFF"i _ a:(VestingNode / GateExpr) {
  if (a.type === "SINGLETON" && a.base.type === "EVENT" && a.base.value === "grantDate") {
    throw new SyntaxError('grantDate is a reserved system event that cannot be used in a `CLIFF` statement. The `CLIFF` will refer to the computed `vestingStart` date, unless an alternative event is provided.')
  }
  return a
};

ScheduleBlock
  = f:From? _ p:OverEveryOpt _ c:Cliff? {
    const base = {
      type: "SINGLETON",
      vesting_start: f,
      periodicity: p,
    };
    if (c) base.periodicity.cliff = c;
    return base
  }

// The body after THEN. It looks like a normal VEST clause but has no FROM: a
// THEN segment picks up where the previous one ended, so it can't also declare
// its own start. The two guard rules catch the natural mistakes and explain the
// fix instead of failing with a bare "unexpected token".
VestTail
  = _ &"[" {
      error("THEN chains single schedules in sequence; it can't chain onto a parallel group. To run schedules in parallel after a chain, give each its own FROM under PLUS.")
    }
  / a:Amount? _ "VEST"i _ "FROM"i {
      error("FROM can't follow THEN: a THEN segment continues from the previous segment's end and has no start of its own. To start an independent schedule, use PLUS with its own FROM.")
    }
  / a:Amount? _ "VEST"i _ p:OverEveryOpt _ c:Cliff? {
      const expr = { type: "SINGLETON", vesting_start: null, periodicity: p };
      if (c) expr.periodicity.cliff = c;
      return { chained: true, amount: a ?? mkPortion(1, 1), expr };
    }

ScheduleExpr = ScheduleSelector / ScheduleBlock

ScheduleSelector
  = op:("EARLIER"i / "LATER"i) _ "OF"i _ "(" _ head:ScheduleExpr tail:(CommaSep ScheduleExpr)* _ ")" {
      return {
        type: op.toUpperCase() === "EARLIER" ? "EARLIER_OF" : "LATER_OF",
        items: collectTwoOrMore(head, tail)
      };
    }
