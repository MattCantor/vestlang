DateAnchor
  = "DATE"i _ iso:$([0-9] [0-9] [0-9] [0-9] "-" [0-1] [0-9] "-" [0-3] [0-9]) {
      return mkDate(iso);
    }

EventAnchor = "EVENT"i _ name:Ident { return mkEvent(name); }
