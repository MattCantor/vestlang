start
  = _ s:schedule { return s; }

schedule
  = "schedule" _ name:identifier _ "{" _ items:vestingItem+ _ "}" {
    return {
      type: "Schedule",
      name,
      items
    };
  }

vestingItem
  = "cliff" _ duration:[0-9]+ "months" _ ":" _ percent:[0-9]+ "%" {
    return {
      type: "Cliff",
      duration: parseInt(duration.join("")),
      percent: parseInt(percent.join(""))
    };
  }

identifier
  = first:[a-zA-Z_] rest:[a-zA-Z0-9_]* {
      return first + rest.join("");
    }

_ = [ \t\n\r]*

