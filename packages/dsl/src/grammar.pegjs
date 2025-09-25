{
  // helper JS (ESM is fine here)
  function mkDuration(value, unit) { return { kind: "Duration", value, unit }; }
  function mkDate(iso) { return { kind: "Date", iso }; }
  function mkEvent(name) { return { kind: "Event", name }; }
}

Start
  = _ amt:Number _ "VEST"i _ s:ScheduleBlock? _ i:IfBlock? _ {
      return { amount: { kind: "Amount", value: amt }, schedule: s ?? null, if: i ?? null };
    }

ScheduleBlock
  = "SCHEDULE"i _ f:From _ o:Over _ e:Every _ c:Cliff? {
      return { from: f, over: o, every: e, cliff: c ?? { kind: "Zero" } };
    }
  / "SCHEDULE"i _ o:Over _ e:Every _ c:Cliff? {
      return { over: o, every: e, cliff: c ?? { kind: "Zero" } };
    }

From
  = "FROM"i _ a:(DateAtom / EventAtom) { return a; }

Over
  = "OVER"i _ d:Duration { return d; }

Every
  = "EVERY"i _ d:Duration { return d; }

Cliff
  = "CLIFF"i _ v:(
      "0" _ "days"i { return { kind: "Zero" }; }
    / d:Duration    { return d; }
    / d:DateAtom    { return d; }
    ) { return v; }

IfBlock
  = "IF"i _ c:Condition { return c; }

Condition
  = "EARLIER"i _ "OF"i _ "(" _ list:CondList _ ")" { return { kind:"EarlierOf", items: list }; }
  / "LATER"i _ "OF"i _ "(" _ list:CondList _ ")" { return { kind:"LaterOf", items: list }; }
  / "AT"i _ d:DateAtom { return { kind:"At", date: d }; }
  / "AFTER"i _ d:Duration { return { kind:"After", duration: d }; }
  / e:EventAtom { return e; }

CondList
  = head:Condition tail:(_ "," _ Condition)* {
      return [head, ...tail.map(t => t[3])];
    }

Duration
  = n:Number _ u:Unit {
      return mkDuration(n, u);
    }

Unit
  = "day"i "s"? { return "days"; }
  / "week"i "s"? { return "weeks"; }
  / "month"i "s"? { return "months"; }
  / "year"i "s"? { return "years"; }

DateAtom
  = iso:$([0-9][0-9][0-9][0-9] "-" [0-1][0-9] "-" [0-3][0-9]) {
      return mkDate(iso);
    }

EventAtom
  = name:Ident { return mkEvent(name); }

Ident
  = $([A-Za-z_][A-Za-z0-9_]*)

Number
  = $([0-9]+ ("." [0-9]+)?) { return parseFloat(text()); }

_ = [ \t\r\n]*

