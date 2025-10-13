From = "FROM"i _ a:(VestingNode / GateExpr) { return a; }

Cliff = "CLIFF"i _ a:(VestingNode / GateExpr) { return a; };

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
        conditions: null
      },
      periodicity: p,
    };
    if (c) base.cliff = c;
    return base
  }


