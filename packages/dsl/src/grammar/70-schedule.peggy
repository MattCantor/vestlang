From = "FROM"i _ a:(VestingNode / GateExpr) {
  if (a.type === "SINGLETON" && a.base.type === "EVENT" && a.base.value === "vestingStart") {
    throw new SyntaxError('vestingStart is a reserved system event that cannot be used in a `FROM` statement. Pick a different event name.')
  }
  return a
}

Cliff = "CLIFF"i _ a:(VestingNode / GateExpr) {
  if (a.type === "SINGLETONE" && a.base.type === "EVENT" && a.base.value === "grantDate") {
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

ScheduleExpr = ScheduleSelector / ScheduleBlock

ScheduleSelector
  = op:("EARLIER"i / "LATER"i) _ "OF"i _ "(" _ head:ScheduleExpr tail:(CommaSep ScheduleExpr)* _ ")" {
      return {
        type: op.toUpperCase() === "EARLIER" ? "EARLIER_OF" : "LATER_OF",
        items: collectTwoOrMore(head, tail)
      };
    }
