DateLiteral
  = "DATE"i _ iso:$([0-9][0-9][0-9][0-9] "-" [0-1][0-9] "-" [0-3][0-9]) {
      return mkDate(iso);
    }

Ident = $([A-Za-z_][A-Za-z0-9_]*)

EventRef = "EVENT"i _ name:Ident {
  if (isSystemEvent(name)) {
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
      const offs = offsets.map(o => o[1])
      const node = {
        type: "SINGLETON",
        base,
        offsets: normalizeOffsets(offs)
      }
      if (constraints) node.constraints = constraints[1]
      return node 
  }

Constraint
  = s:Strict? _ op:("BEFORE"i / "AFTER"i) _ base:VestingNode {
    return {
      type: "ATOM",
      constraint: {
        type: op.toUpperCase(),
        base,
        strict: !!s
      }
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
