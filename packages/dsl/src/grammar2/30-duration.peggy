BareDuration
  = n:Integer _ u:Unit {
      switch (u) {
        case "weeks":
          return mkDuration(n * 7, "DAYS", "PLUS");
        case "years":
          return mkDuration(n* 12, "MONTHS", "PLUS");
        case "DAYS":
        case "MONTHS":
          return mkDuration(n, u, "PLUS");
        default:
          error("Unknown duration unit: " + u);
      }
    }

DurationWithOffset
  = s:Offset _ n:Integer _ u:Unit {
      const sign = s === "-" ? "MINUS" : "PLUS";
      switch (u) {
        case "weeks":
          return mkDuration(n * 7, "DAYS", sign);
        case "years":
          return mkDuration(n* 12, "MONTHS", sign);
        case "DAYS":
        case "MONTHS":
          return mkDuration(n, u, sign);
        default:
          error("Unknown duration unit: " + u);
      }
    }

Unit
  = "day"i "s"? { return "DAYS"; }
  / "month"i "s"? { return "MONTHS"; }
  / "week"i "s"? { return "weeks"; } // will be converted to DAYS
  / "year"i "s"? { return "years"; } // will be converted to MONTHS
