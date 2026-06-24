_ = [ \t\r\n]*

AndSep = _ "AND"i _ { return "AND"; }

OrSep = _ "OR"i _ { return "OR"; }

CommaSep = _ "," _

Offset = ("+" / "-")

// The single integer entry point — feeds Quantity, both Fraction terms, and every
// Duration magnitude (OVER/EVERY spans, offsets). parseInt silently rounds past 2^53−1,
// so guard the digit string here, before coercion: an integer that big can't be held
// exactly as a number anywhere it lands (a share count, a fraction term, a period count
// are all equally uncomputable). BigInt is for the comparison only; the stored value
// stays a safe number. Leading zeros are fine — BigInt parses them.
Integer = s:$[0-9]+ !"." {
    assertSafeInteger(BigInt(s));
    return parseInt(s, 10);
  }
