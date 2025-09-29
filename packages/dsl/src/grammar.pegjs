{
  // helper JS (ESM is fine here)
  function mkDuration(value, unit) { return { type: "Duration", value, unit }; }
  function mkDate(iso) { return { type: "Date", iso }; }
  function mkEvent(name) { return { type: "Event", name }; }
  function mkAmountInteger(n) { return { type: "AmountInteger", value: n }; }
  function mkAmountPercent(x) { return { type: "AmountPercent", value: x}; }
  function mkQualified(base, qualifier) { return qualifier ? { type: "Qualified", base, qualifier } : base; }
}

Start
  = _ a:Amount?  _ "VEST"i _ e:Expr _ {
      const amt = a ?? mkAmountPercent(1); // default 100%
      return { amount: amt, expr: e };
    }

/* ------------------------------
   Amount
   ----------------------------- */

Amount
  // any whole number
  = x:Decimal {
  	if (x < 0 || x > 1) {
	error("Decimal amount must be between 0 and 1 inclusive");
	}
	return mkAmountPercent(x);
  }
  / n:Integer { return mkAmountInteger(n); }

// Strict integer: one or more digits, no dot
Integer
  = s:$([0-9]+) !'.' { return parseInt(s, 10); }

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
  / "EARLIER"i _ "OF"i _ "(" _ xs:ExprList _ ")" {
      return { type: "EarlierOfSchedules", items: xs };
    }
  / "LATER"i _ "OF"i _ "(" _ xs:ExprList _ ")" {
      return { type: "LaterOfSchedules", items: xs };
    }

ExprList
  = head:Expr tail:(_ "," _ Expr)* {
      return [head, ...tail.map(t => t[3])];
    }

/* ------------------------------
   Schedule block (time-based)
   ------------------------------ */

ScheduleBlock
  = "SCHEDULE"i _ f:From? _ oe:OverEveryOpt _ c:Cliff? {
      return {
	type: "Schedule",
      	from: f ?? null, // TODO: Normalizer should inject EVENT grantDate when FROM is null
	over: oe.over,
	every: oe.every,
	cliff: c ?? { type: "Zero" }
	};
    }

// Enforce both-or-none for OVER/EVERY, and inject type: "Zero" when ommitted 
OverEveryOpt
  = o:Over _ e:Every { return { over: o, every: e }; }
  / o:Over { error("EVERY must be provided when OVER is present"); }
  / e:Every { error("OVER must be provided when EVERY is present"); }
  /"" { return { over: { type: "Zero" }, every: { type: "Zero"}}; }

/* -------------------------------
   FROM with combinators + qualifiers
   ------------------------------ */

From
  = "FROM"i _ a:FromTerm { return a; }

FromTerm
  = a:QualifiedAtom { return a; }
  / "EARLIER"i _ "OF"i _ "(" _ xs:FromTermList _ ")" {
  return { type: "EarlierOf", items: xs }; }
  / "LATER"i _ "OF"i _ "(" _ xs:FromTermList _ ")" { return { type: "LaterOf", items: xs }; }

  FromTermList
    = head:FromTerm tail:(_ "," _ FromTerm)* { return [head, ...tail.map(t => t[3])];}

/* ----------------------------------
   OVER / EVERY (durations)
   --------------------------------- */

Over
  = "OVER"i _ d:Duration { return d; }

Every
  = "EVERY"i _ d:Duration { return d; }

/* ----------------------------------
   CLIFF with combinators + qualifiers
   --------------------------------- */

Cliff
  = "CLIFF"i _ v:CliffTerm { return v; }

CliffTerm
  = "0" _ "days"i { return { type: "Zero" }; }
  / d:Duration    { return d; }
  / a:QualifiedAtom    { return a; }
  / "EARLIER"i _  "OF"i _ "(" _ xs:CliffTermList _ ")" { return { type: "EarlierOf", items: xs }; }
  / "LATER"i _ "OF"i _ "(" _ xs:CliffTermList _ ")" { return { type: "LaterOf", items: xs }; }

CliffTermList
  = head:CliffTerm tail:(_ "," _ CliffTerm)* { return [head, ...tail.map(t => t[3])];}

/* -----------------------------
   Temporal qualifiers
   ----------------------------- */

QualifiedAtom
 = base:(DateAtom / EventAtom) _ q:TemporalQualifier? { return mkQualified(base, q ?? null); }

TemporalQualifier
 = "BY"i _ t:(DateAtom / EventAtom) { return { type: "By", target: t }; }
 / "BEFORE"i _ t:(DateAtom / EventAtom) { return { type: "Before", target: t }; }
 / "AFTER"i _ t:(DateAtom / EventAtom) { return { type: "After", target: t }; }
 / "BETWEEN"i _ a:(DateAtom / EventAtom) _ "AND" _ b:(DateAtom / EventAtom) { return { type: "Between", start: a, end: b }; }

/* ------------------------------
   Lexical helpers
   ------------------------------ */

Duration
  = n:Number _ u:Unit {
      if (u === "weeks") return mkDuration(n * 7, "days");
      if (u === "years") return mkDuration(n * 12, "months");
      return mkDuration(n, u);
    }

Unit
  = "day"i "s"? { return "days"; }
  / "month"i "s"? { return "months"; }
  / "week"i "s"? { return "weeks"; }
  / "year"i "s"? { return "years"; }

DateAtom
  = "DATE"i _ iso:$([0-9][0-9][0-9][0-9] "-" [0-1][0-9] "-" [0-3][0-9]) {
      return mkDate(iso);
    }

EventAtom
  = "EVENT"i _ name:Ident { return mkEvent(name); }

Ident
  = $([A-Za-z_][A-Za-z0-9_]*)

Number
  = $([0-9]+ ("." [0-9]+)?) { return parseFloat(text()); }

_ = [ \t\r\n]*

