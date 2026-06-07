Duration
  = s:Offset? _ n:Integer _ u:Unit {
      const sign = s === "-" ? "MINUS" : "PLUS"; // default to PLUS
      switch (u) {
        case "weeks":
          return mkDuration(n * 7, "DAYS", sign);
        case "years":
          return mkDuration(n * 12, "MONTHS", sign);
        case "DAYS":
        case "MONTHS":
          return mkDuration(n, u, sign);
        default:
          error("Unknown duration unit: " + u);
      }
    }

Unit
  = "day"i "s"i? { return "DAYS"; }
  / "month"i "s"i? { return "MONTHS"; }
  / "week"i "s"i? { return "weeks"; } // will be converted to DAYS
  / "year"i "s"i? { return "years"; } // will be converted to MONTHS
