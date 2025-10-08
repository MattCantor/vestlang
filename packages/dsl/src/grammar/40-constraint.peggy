ConstrainedAnchor
  = base:(DateAnchor / EventAnchor) _ q:TemporalConstraintList? {
      return mkConstrained(base, q ?? null);
    }

/* A single atomic constraint */
BaseConstraint
  = s:Strict? _ "BEFORE"i _ t:(DateAnchor / EventAnchor) {
      return { type: "Before", anchor: t, strict: !!s };
    }
  / s:Strict? _ "AFTER"i _ t:(DateAnchor / EventAnchor) {
      return { type: "After", anchor: t, strict: !!s };
    }

/* Parenthesized OR of BaseConstraint(s). Requires 2+ items. */
OrGroup
  = "(" _ head:BaseConstraint tail:(OrSep BaseConstraint)+ _ ")" {
      return { anyof: collect(head, tail) };
    }

/* One entry in the AND-list: either atomic or an OR-group */
ConstraintEntry
  = BaseConstraint
  / OrGroup

/* AND-chain of entries. When mixing AND/OR, parentheses are required */
TemporalConstraintList
  = head:ConstraintEntry tail:(AndSep ConstraintEntry)* {
      return collect(head, tail);
    }
