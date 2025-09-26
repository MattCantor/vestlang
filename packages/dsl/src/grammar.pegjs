{
  // helper JS (ESM is fine here)
  function mkDuration(value, unit) { return { kind: "Duration", value, unit }; }
  function mkDate(iso) { return { kind: "Date", iso }; }
  function mkEvent(name) { return { kind: "Event", name }; }
}

Start
  = _ amt:Number _ "VEST"i _ ts:TopStmt _ {
      // NOTE: top-level now returns a composable TopStmt, not just {schedule, if}
      return { amount: { kind: "Amount", value: amt }, top: ts };
    }

/* ------------------------------
   Top-level composition (Programs)
   ------------------------------ */

TopStmt
  = p:Program { return p; }
  / "EARLIER"i _ "OF"i _ "(" _ xs:TopStmtList _ ")" {
      return { kind: "EarlierOfPrograms", items: xs };
    }
  / "LATER"i _ "OF"i _ "(" _ xs:TopStmtList _ ")" {
      return { kind: "LaterOfPrograms", items: xs };
    }

TopStmtList
  = head:TopStmt tail:(_ "," _ TopStmt)* {
      return [head, ...tail.map(t => t[3])];
    }

/* ------------------------------
   Program (single schedule + optional IF)
   ------------------------------ */

Program
  = s:ScheduleBlock _ i:IfBlock? {
      return { kind: "Program", schedule: s, if: i ?? null };
    }
  / i:IfBlock {
      // one-shot sugar: CNF layer will inject SCHEDULE OVER 0 EVERY 0 FROM grantDate
      return { kind: "Program", schedule: null, if: i };
    }

/* ------------------------------
   Schedule block (time-based)
   ------------------------------ */

ScheduleBlock
  = "SCHEDULE"i _ f:From _ o:Over _ e:Every _ c:Cliff? {
      return { from: f, over: o, every: e, cliff: c ?? { kind: "Zero" } };
    }
  / "SCHEDULE"i _ o:Over _ e:Every _ c:Cliff? {
      return { from: null, over: o, every: e, cliff: c ?? { kind: "Zero" } };
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

/* ------------------------------
   IF block (event/date conditions)
   ------------------------------ */

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

/* ------------------------------
   Lexical helpers
   ------------------------------ */

Duration
  = n:Number _ u:Unit {
      return mkDuration(n, u);
    }

Unit
  = "day"i "s"? { return "days"; }
  / "month"i "s"? { return "months"; }

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

