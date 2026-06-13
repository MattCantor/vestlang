/* --- Lexical Helpers --- */

// The colon is reserved: the evaluator mints synthetic stand-in event ids (the
// `evt:<n>` it invents when a start is too complex to store directly) into that
// namespace, and relies on no user-authored name ever colliding with one. Because
// this alphabet has no colon, the two strings can never be equal. Never add a
// colon to the identifier alphabet — doing so reopens that collision.
Ident = $([A-Za-z_][A-Za-z0-9_]*)
Strict = "STRICTLY"i { return true; }

/* --- Vesting Base --- */

DateLiteral
  = "DATE"i _ iso:$([0-9][0-9][0-9][0-9] "-" [0-1][0-9] "-" [0-3][0-9]) {
      // The lexical shape above admits impossibles (month 00–19, day 00–39);
      // reject the ones that aren't real calendar dates with a located error.
      if (!isValidCalendarDate(iso)) {
        error(`"${iso}" is not a valid calendar date`);
      }
      return mkDate(iso);
    }

// A system anchor's identity is a base tag, not a string — so SystemRef returns
// the base node directly, which is how EventRef tells a reserved anchor apart
// from a genuine event (a string) without risking a name collision.
SystemRef
  = "grantdate"i { return mkGrantDate(); }
  / "grant_date"i { return mkGrantDate(); }
  / "grant-date"i { return mkGrantDate(); }
  / "vestingstart"i { return mkVestingStart(); }
  / "vesting_start"i { return mkVestingStart(); }
  / "vesting-start"i { return mkVestingStart(); }


EventRef = "EVENT"i _ a:( SystemRef / Ident ) {
  return typeof a === "string" ? mkEvent(a) : a;
}

// Bareword system references (grantDate / vestingStart and their variants)
// may be used as anchors without the `EVENT` keyword.
SystemRefEvent = SystemRef

/* --- Vesting Node --- */

VestingNode
  = base:(EventRef / SystemRefEvent / DateLiteral)
    offsets:(_ Duration)*
    condition:(_ OrExpr)? {
      const offs = offsets.map(o => o[1])
      const node = {
        type: "NODE",
        base,
        offsets: normalizeOffsets(offs)
      }
      if (condition) node.condition = condition[1]
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

// Function form: AND(...), OR(...). These bind like their infix versions. The
// explicit call is grouping, so the result is marked grouped.
FuncBool
  = op:("AND"i / "OR"i) "(" _ head:OrExpr tail:(CommaSep OrExpr)* _ ")" {
    const OP = op.toUpperCase();
    return markGrouped(mkBool(OP, collect(head, tail)))
  }

// Parenthesized — explicit grouping, so the inner result is marked grouped.
Paren
  = "(" _ e:OrExpr _ ")" { return markGrouped(e); }

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
    // Flag a bare `… OR … AND …`: SQL precedence groups it silently. Check the
    // raw operands, before mkBool flattens any grouped child OR into this node.
    const operands = collect(head, tail);
    return flagMixedInfix(mkBool("OR", operands), operands, location())
  }


