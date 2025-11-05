/* --- Lexical Helpers --- */

Ident = $([A-Za-z_][A-Za-z0-9_]*)
Strict = "STRICTLY"i { return true; }

/* --- Vesting Base --- */

DateLiteral
  = "DATE"i _ iso:$([0-9][0-9][0-9][0-9] "-" [0-1][0-9] "-" [0-3][0-9]) {
      return mkDate(iso);
    }

SystemRef
  = "grantdate"i { return "grantDate"; }
  / "grant_date"i { return "grantDate"; }
  / "grant-date"i { return "grantDate"; }
  / "vestingstart"i { return "vestingStart"; }
  / "vesting_start"i { return "vestingStart"; }
  / "vesting-start"i { return "vestingStart"; }


EventRef = "EVENT"i _ name:( SystemRef / Ident ) { return mkEvent(name); }

/* --- Vesting Node --- */

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

// A binary constraint whose subject is the enclosing VestingNode
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

// Function form: AND(...), OR(...). These bind like their infix versions
FuncBool
  = op:("AND"i / "OR"i) "(" _ head:OrExpr tail:(CommaSep OrExpr)* _ ")" {
    const OP = op.toUpperCase();
    return mkBool( OP, collect(head, tail))
  }

// Parenthesized
Paren
  = "(" _ e:OrExpr _ ")" { return e; }

Condition = Paren / FuncBool / Constraint

// AND binds tighter than OR
AndExpr
  = head:Condition tail:(AndSep Condition)* {
    if (tail.length === 0) return head;
    return mkBool("AND", collect(head, tail))
  }

OrExpr
  = head:AndExpr tail:(OrSep AndExpr)* {
    if (tail.length === 0) return head;
    return mkBool("OR", collect(head, tail))
  }


