Duration
  = n:Integer _ u:Unit {
      if (u === "weeks") return mkDuration(n * 7, "DAYS");
      if (u === "years") return mkDuration(n * 12, "MONTHS");
      return mkDuration(n, u);
    }

Unit
  = "day"i "s"? { return "DAYS"; }
  / "month"i "s"? { return "MONTHS"; }
  / "week"i "s"? { return "weeks"; }
  / "year"i "s"? { return "years"; }
