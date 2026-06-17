From = "FROM"i _ a:(VestingNode / GateExpr) {
  if (hasSystemAnchor(a, "VESTING_START")) {
    error('vestingStart is a reserved system event that cannot be used in a `FROM` statement. Pick a different event name.')
  }
  // vestingStart in this start's gate is circular: the gate would constrain the
  // very start it defines, which isn't resolved yet. The anchor check above runs
  // first and owns the anchor position; only a gate-position reference reaches
  // here. (On a CLIFF the same reference is fine — vestingStart is resolved by
  // then — so this guard is FROM-only.)
  if (nodeGateRefsVestingStart(a)) {
    error('vestingStart is a reserved system event and creates a circular dependency when referenced in a `FROM` start gate: the start would depend on itself. Gate the start on a concrete date or a different event.')
  }
  return a
}

Cliff = "CLIFF"i _ a:(VestingNode / GateExpr) {
  if (hasSystemAnchor(a, "GRANT_DATE")) {
    error('grantDate is a reserved system event that cannot be used in a `CLIFF` statement. The `CLIFF` will refer to the computed `vestingStart` date, unless an alternative event is provided.')
  }
  return a
};

ScheduleBlock
  = f:From? _ p:OverEveryOpt _ c:Cliff? {
    const base = {
      type: "SCHEDULE",
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
      const expr = { type: "SCHEDULE", vesting_start: null, periodicity: p };
      if (c) expr.periodicity.cliff = c;
      return { type: "STATEMENT", chained: true, amount: a ?? mkPortion(1, 1), expr };
    }

ScheduleExpr = ScheduleSelector / ScheduleSelectorHint / ScheduleBlock

// Selects between whole schedules by their vesting-start date: EARLIER START OF
// keeps the one that starts first, LATER START OF the one that starts last, and
// the losing schedule (its cadence, cliff, amount) is dropped. The START word
// names that comparison key, and keeps this distinct from the anchor-level
// EARLIER OF / LATER OF (in 50-gate.peggy), which chooses between bare anchors
// inside FROM / CLIFF.
ScheduleSelector
  = op:("EARLIER"i / "LATER"i) _ "START"i _ "OF"i _ "(" _ head:ScheduleExpr tail:(CommaSep ScheduleExpr)* _ ")" {
      return {
        type: op.toUpperCase() === "EARLIER" ? "SCHEDULE_EARLIER_OF" : "SCHEDULE_LATER_OF",
        items: collectTwoOrMore(head, tail)
      };
    }

// A bare EARLIER OF / LATER OF where a schedule-expr is expected is the
// anchor-level selector used at the wrong level; point at the schedule-level
// keyword instead of failing with a bare "unexpected token".
ScheduleSelectorHint
  = ("EARLIER"i / "LATER"i) _ "OF"i _ "(" {
      error("`EARLIER OF` / `LATER OF` selects between anchors and is used inside `FROM` / `CLIFF`. To pick a whole schedule by its vesting start, write `EARLIER START OF (...)` / `LATER START OF (...)`.")
    }
