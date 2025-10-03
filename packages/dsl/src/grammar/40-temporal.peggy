QualifiedAtom
  = base:(DateAtom / EventAtom) _ q:TemporalPredicateList? {
      return mkQualified(base, q ?? null);
    }

TemporalPredicateList
  = head:TemporalPred tail:(AndSep TemporalPred)* {
      return collect(head, tail);
    }

TemporalPred
  = s:Strict?
    _
    "BETWEEN"i
    _
    a:(DateAtom / EventAtom)
    _
    "AND"i
    _
    b:(DateAtom / EventAtom) { return { type: "Between", a, b, strict: !!s }; }
  / s:Strict? _ "BEFORE"i _ t:(DateAtom / EventAtom) {
      return { type: "Before", i: t, strict: !!s };
    }
  / s:Strict? _ "AFTER"i _ t:(DateAtom / EventAtom) {
      return { type: "After", i: t, strict: !!s };
    }
