DateLiteral
  = "DATE"i _ iso:$([0-9][0-9][0-9][0-9] "-" [0-1][0-9] "-" [0-3][0-9]) {
      return mkDate(iso);
    }

Ident = $([A-Za-z_][A-Za-z0-9_]*)

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
    constraints:(_ OrExpr)? {
      return {
        type: constraints ? "CONSTRAINED" : "BARE",
        base,
        offsets: offsets.map(o => o[1]),
        constraints: constraints?.[1] ?? null
      }
  }

Constraint
  = s:Strict? _ op:("BEFORE"i / "AFTER"i) _ base:(VestingNode / GateExpr) {
    if (isDuration(base)) {
      error(`When used with ${op}, a duration may only follow an EVENT or DATE. Use e.g,: ${op} EVENT <milestone> ${base.sign} ${base.value} ${base.unit}`)
    }
    return {
      type: op.toUpperCase(),
      base,
      strict: !!s
    }
  }

ParenCondition
  = "(" _ e:OrExpr _ ")" { return e; }

FunctionCondition
  = op:("AND"i / "OR"i) "(" _ head:OrExpr tail:(CommaSep OrExpr)* _ ")" {
    const OP = op.toUpperCase();
    return mkBool( OP, collect(head, tail))
  }

Condition = ParenCondition / FunctionCondition / Constraint

OrExpr
  = head:AndExpr tail:(OrSep AndExpr)* {
    if (tail.length === 0) return head;
    return mkBool("OR", collect(head, tail))
  }

AndExpr
  = head:Condition tail:(AndSep Condition)* {
    if (tail.length === 0) return head;
    return mkBool("AND", collect(head, tail))
  }
