From = "FROM"i _ a:(VestingNode / GateExpr) {
  return a
}

Cliff = "CLIFF"i _ a:(VestingNode / GateExpr) {
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
