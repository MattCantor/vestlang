DateLiteral
  = "DATE"i _ iso:$([0-9][0-9][0-9][0-9] "-" [0-1][0-9] "-" [0-3][0-9]) {
      return mkDate(iso);
    }

Ident = $([A-Za-z_] [A-Za-z0-9_]*)

EventRef = "EVENT"i _ name:Ident {
  if (isSystemEvent(name.toLowerCase())) {
    error(
      `'${name}' is a reserved system event. ` +
      'Pick a different event name'
    );
  }
  return mkEvent(name); }

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

ConditionExpr = ConditionSelector / VestingNode

ConditionSelector
  = op:("EARLIER"i / "LATER"i) _ "OF"i _ "(" _ head:ConditionExpr tail:(CommaSep ConditionExpr)* _ ")" {
      return {
        type: op.toUpperCase() === "EARLIER" ? "EARLIER_OF" : "LATER_OF",
        items: collectTwoOrMore(head, tail)
      };
    }

Condition
  = s:Strict? _ op:("BEFORE"i / "AFTER"i) _ base:(VestingNode / GateExpr) {
    if (isDuration(base)) {
      error(`When used with ${op}, a duration may only follow an EVENT or DATE. E.g., ${op} EVENT <milestone> ${base.sign} ${base.value} ${base.unit}`)
    }
    return {
      type: op.toUpperCase(),
      base,
      strict: !!s
    }
  }
