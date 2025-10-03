_ = [ \t\r\n]*

AndSep = _ "AND"i _

CommaSep = _ "," _

Strict = "STRICTLY"i

Ident = $([A-Za-z_] [A-Za-z0-9_]*)

Integer = s:$[0-9]+ !"." { return parseInt(s, 10); }

Decimal
  = s:$(
    ("." [0-9]+) // .5
    / ([0-1] "." [0-9]+) // 0.x or 1.x
  ) { return parseFloat(s); }

Number = $([0-9]+ ("." [0-9]+)?) { return parseFloat(text()); }
