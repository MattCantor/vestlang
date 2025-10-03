Over = "OVER"i _ d:Duration { return d; }

Every = "EVERY"i _ d:Duration { return d; }

OverEveryOpt
  = o:Over _ e:Every { return { over: o, every: e }; }
  / o:Over { error("EVERY must be provided when OVER is present"); }
  / e:Every { error("OVER must be provided when EVERY is present"); }
  / "" { return { over: mkDuration(0, "DAYS"), every: mkDuration(0, "DAYS") }; }

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
