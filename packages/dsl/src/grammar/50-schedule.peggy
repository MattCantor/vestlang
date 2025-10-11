Over = "OVER"i _ d:Duration { return d; }

Every = "EVERY"i _ d:Duration { return d; }

OverEveryOpt
  = o:Over _ e:Every { return { over: o, every: e }; }
  / o:Over { error("EVERY must be provided when OVER is present"); }
  / e:Every { error("OVER must be provided when EVERY is present"); }
  / "" { return { over: mkDuration(0, "DAYS"), every: mkDuration(0, "DAYS") }; }

From = "FROM"i _ a:FromTerm { return a; }

FromTerm
  = a:ConstrainedAnchor { return a; }
  / "EARLIER"i _ "OF"i _ "(" _ xs:FromTermListTwoOrMore _ ")" {
      return { type: "EARLIER_OF", items: xs };
    }
  / "LATER"i _ "OF"i _ "(" _ xs:FromTermListTwoOrMore _ ")" {
      return { type: "LATER_OF", items: xs };
    }

FromTermListTwoOrMore
  = head:FromTerm tail:(CommaSep FromTerm)* {
      return collectTwoOrMore(head, tail);
    }

Cliff = "CLIFF"i _ v:CliffTerm { return v; }

CliffTerm
  = d:Duration { return d; }
  / a:ConstrainedAnchor { return a; }
  / "EARLIER"i _ "OF"i _ "(" _ xs:CliffTermListTwoOrMore _ ")" {
      return { type: "EARLIER_OF", items: xs };
    }
  / "LATER"i _ "OF"i _ "(" _ xs:CliffTermListTwoOrMore _ ")" {
      return { type: "LATER_OF", items: xs };
    }

CliffTermListTwoOrMore
  = head:CliffTerm tail:(CommaSep CliffTerm)* {
      return collectTwoOrMore(head, tail);
    }

ScheduleBlock
  = f:From? _ oe:OverEveryOpt _ c:Cliff? {
      const base = {
        type: "SINGLETON",
        from: f,
        over: oe.over,
        every: oe.every,
      };
      if (c) base.cliff = c;
      return base;
    }
