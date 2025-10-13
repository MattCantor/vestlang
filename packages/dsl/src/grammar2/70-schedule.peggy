From = "FROM"i _ a:(VestingNode / GateExpr) {
  if (isDuration(a)) {
    return mkGrantDateNode(a);
  }
  return a;
}

Cliff = "CLIFF"i _ a:(VestingNode / GateExpr) {
  if (isDuration(a)) {
    return mkVestingStartNode(a);
  }
  return a;
};

ScheduleBlock
  = f:From? _ p:OverEveryOpt _ c:Cliff? {
    const base = {
      type: "SINGLETON",
      vesting_start: f ?? {
        type: "BARE",
        base: {
          type: "EVENT",
          value: "grantDate"
        },
        offsets: [],
        constraints: null
      },
      periodicity: p,
    };
    if (c) base.cliff = c;
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
