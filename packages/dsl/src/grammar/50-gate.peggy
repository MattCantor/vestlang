// Ordered choice, first-match-wins and load-bearing: MultiBareOffset MUST sit
// before Duration. A bare multi-term offset (`+20 days +1 month`) has no anchor
// base, so it never enters VestingNode; if Duration came first it would match the
// single leading term (`+20 days`), stop, and the parser would choke on the second
// `+` (the #460 bug). MultiBareOffset requires two-or-more terms, so the single-term
// `+3 months` still falls through to Duration unchanged. An anchored node (with a
// base) still wins via VestingNode ahead of both.
GateExpr = GateSelector / VestingNode / MultiBareOffset / Duration

// A bare, anchorless multi-term offset used as a selector arm. Unlike the top-level
// BareFromOffset / BareCliffOffset wrappers (70-schedule.peggy), an arm has no fixed
// system base at grammar time — the same text anchors to grantDate under a FROM slot
// and vestingStart under a CLIFF slot — so we emit a raw un-anchored carrier and let
// normalizeNode anchor it per slot. Reuses MultiOffsets (two-or-more terms, aggregated
// months-first by normalizeOffsets).
MultiBareOffset
  = offsets:MultiOffsets { return { type: "DURATION_OFFSETS", offsets }; }

GateSelector
  = op:("EARLIER"i / "LATER"i) _ "OF"i _ "(" _ head:GateExpr tail:(CommaSep GateExpr)* _ ")" {
      return {
        type: op.toUpperCase() === "EARLIER" ? "NODE_EARLIER_OF" : "NODE_LATER_OF",
        items: collectTwoOrMore(head, tail)
      };
    }
