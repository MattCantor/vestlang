_ = [ \t\r\n]*

AndSep = _ "AND"i _ { return "AND"; }

OrSep = _ "OR"i _ { return "OR"; }

CommaSep = _ "," _

Offset = ("+" / "-")

Integer = s:$[0-9]+ !"." { return parseInt(s, 10); }
