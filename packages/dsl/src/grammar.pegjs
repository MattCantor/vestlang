{
  // helper JS (ESM is fine here)
  function mkDuration(value, unit) {
    return { type: "Duration", value, unit };
  }
  function mkDate(iso) {
    return { type: "Date", value: iso };
  }
  function mkEvent(name) {
    return { type: "Event", value: name };
  }
  function mkAmountAbsolute(n) {
    return { type: "AmountAbsolute", value: n };
  }
  function mkAmountPercent(x) {
    return { type: "AmountPercent", value: x };
  }
  function mkQualified(base, preds) {
    return preds && preds.length
      ? { type: "Qualified", base, predicates: preds }
      : base;
  }
  function collect(head, tail) {
    return [head, ...tail.map((t) => t[1])];
  }
  function collectTwoOrMore(head, tail) {
    const arr = collect(head, tail);
    if (arr.length < 2) error("At least two items are required");
    return arr;
  }
}

Start
  = _ a:Amount? _ "VEST"i _ e:Expr _ {
      const amt = a ?? mkAmountPercent(1); // default 100%
      return { amount: amt, expr: e };
    }

/* ------------------------------
   Amount
   ----------------------------- */

Amount
  // Any decimal in [0,1] is a percent
  = x:Decimal {
      if (x < 0 || x > 1) {
        error("Decimal amount must be between 0 and 1 inclusive");
      }
      return mkAmountPercent(x);
    }
  / n:Integer { return mkAmountAbsolute(n); }

// Strict integer: one or more digits, no dot
Integer = s:$[0-9]+ !"." { return parseInt(s, 10); }

// Decimal with a dot.
// We disallow trailing dot (eg "1.") to avoid ambiguity
Decimal
  = s:$(
    ("." [0-9]+) // .5
    / ([0-1] "." [0-9]+) // 0.x or 1.x
  ) { return parseFloat(s); }

/* ------------------------------
   Expression composition (ScheduleBlocks)
   ------------------------------ */

Expr
  = s:ScheduleBlock { return s; }
  / "EARLIER"i _ "OF"i _ "(" _ xs:ExprListTwoOrMore _ ")" {
      return { type: "EarlierOfSchedules", items: xs };
    }
  / "LATER"i _ "OF"i _ "(" _ xs:ExprListTwoOrMore _ ")" {
      return { type: "LaterOfSchedules", items: xs };
    }

ExprListTwoOrMore
  = head:Expr tail:(CommaSep Expr)* { return collectTwoOrMore(head, tail); }

/* ------------------------------
   Schedule block (time-based)
   ------------------------------ */

ScheduleBlock
  = "SCHEDULE"i _ f:From? _ oe:OverEveryOpt _ c:Cliff? {
      const base = {
        type: "Schedule",
        from: f ?? null,
        over: oe.over,
        every: oe.every,
      };
      if (c) base.cliff = c;
      return base;
    }

// Enforce both-or-none for OVER/EVERY, and inject default when omitted
OverEveryOpt
  = o:Over _ e:Every { return { over: o, every: e }; }
  / o:Over { error("EVERY must be provided when OVER is present"); }
  / e:Every { error("OVER must be provided when EVERY is present"); }
  / "" { return { over: mkDuration(0, "DAYS"), every: mkDuration(0, "DAYS") }; }

/* -------------------------------
   FROM with combinators + qualifiers
   ------------------------------ */

From = "FROM"i _ a:FromTerm { return a; }

FromTerm
  = a:QualifiedAtom { return a; }
  / "EARLIER"i _ "OF"i _ "(" _ xs:FromTermListTwoOrMore _ ")" {
      return { type: "EarlierOf", items: xs };
    }
  / "LATER"i _ "OF"i _ "(" _ xs:FromTermListTwoOrMore _ ")" {
      return { type: "LaterOf", items: xs };
    }

FromTermListTwoOrMore
  = head:FromTerm tail:(CommaSep FromTerm)* {
      return collectTwoOrMore(head, tail);
    }

/* ----------------------------------
   OVER / EVERY (durations)
   --------------------------------- */

Over = "OVER"i _ d:Duration { return d; }

Every = "EVERY"i _ d:Duration { return d; }

/* ----------------------------------
   CLIFF with combinators + qualifiers
   --------------------------------- */

Cliff = "CLIFF"i _ v:CliffTerm { return v; }

CliffTerm
  = d:Duration { return d; }
  / a:QualifiedAtom { return a; }
  / "EARLIER"i _ "OF"i _ "(" _ xs:CliffTermListTwoOrMore _ ")" {
      return { type: "EarlierOf", items: xs };
    }
  / "LATER"i _ "OF"i _ "(" _ xs:CliffTermListTwoOrMore _ ")" {
      return { type: "LaterOf", items: xs };
    }

CliffTermListTwoOrMore
  = head:CliffTerm tail:(CommaSep CliffTerm)* {
      return collectTwoOrMore(head, tail);
    }

/* -----------------------------
   Temporal qualifiers
   ----------------------------- */

QualifiedAtom
  = base:(DateAtom / EventAtom) _ q:TemporalPredicateList? {
      return mkQualified(base, q ?? null);
    }

/* ------------------------------
   Temporal predicates (with STRICTLY + AND)
   ------------------------------ */

TemporalPredicateList
  = head:TemporalPred tail:(AndSep TemporalPred)* {
      return collect(head, tail);
    }

/* A single predicate term (unary or BETWEEN) */
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

/* ------------------------------
   Lexical helpers
   ------------------------------ */

Duration
  = n:Integer _ u:Unit {
      if (u === "weeks") return mkDuration(n * 7, "DAYS");
      if (u === "years") return mkDuration(n * 12, "MONTHS");
      return mkDuration(n, u);
    }

Unit
  = "day"i "s"? { return "DAYS"; }
  / "month"i "s"? { return "MONTHS"; }
  / "week"i "s"? { return "weeks"; }
  / "year"i "s"? { return "years"; }

DateAtom
  = "DATE"i _ iso:$([0-9] [0-9] [0-9] [0-9] "-" [0-1] [0-9] "-" [0-3] [0-9]) {
      return mkDate(iso);
    }

EventAtom = "EVENT"i _ name:Ident { return mkEvent(name); }

AndSep = _ "AND"i _

Strict = "STRICTLY"i

CommaSep = _ "," _

Ident = $([A-Za-z_] [A-Za-z0-9_]*)

Number = $([0-9]+ ("." [0-9]+)?) { return parseFloat(text()); }

_ = [ \t\r\n]*
