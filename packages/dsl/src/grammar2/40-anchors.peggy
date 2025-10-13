DateLiteral
  = "DATE"i _ iso:$([0-9][0-9][0-9][0-9] "-" [0-1][0-9] "-" [0-3][0-9]) {
      return mkDate(iso);
    }

EventRef = "EVENT"i _ name:Ident { return mkEvent(name); }

VestingNode
  = base:(EventRef / DateLiteral)
    offsets:(_ Duration)*
    conditions:(_ ConditionTree)? {
    return {
      type: conditions ? "CONDITIONED" : "BARE",
      base,
      offsets: offsets.map(o => o[1]),
      conditions: conditions?.[1]
    }
  }

InFixConditions
  = head:Condition tail:((AndSep / OrSep) Condition)+ {
    return [
      mkCondition("AND", head),
      ...tail.map((t) => mkCondition(t[0][1].toUpperCase(), t[1]))
    ]
  }

ConditionFunction
  = op:("AND"i / "OR"i) "(" _ head:Condition tail:(CommaSep Condition)* _ ")" {
    return [
     mkCondition(op.toUpperCase(), head),
     ...tail.map((t) => mkCondition(op.toUpperCase(), t[1]))
    ]
  }

SingleCondition
  = c:Condition {
    return [ mkCondition("AND", c) ]
  }

ConditionTree = InFixConditions / ConditionFunction / SingleCondition

Condition
  = s:Strict? _ op:("BEFORE"i / "AFTER"i) _ base:(VestingNode / GateExpr) {
    return {
      type: op.toUpperCase(),
      base,
      strict: !!s
    }
  }
