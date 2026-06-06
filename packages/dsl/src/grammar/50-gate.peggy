GateExpr = GateSelector / VestingNode / Duration 

GateSelector
  = op:("EARLIER"i / "LATER"i) _ "OF"i _ "(" _ head:GateExpr tail:(CommaSep GateExpr)* _ ")" {
      return {
        type: op.toUpperCase() === "EARLIER" ? "NODE_EARLIER_OF" : "NODE_LATER_OF",
        items: collectTwoOrMore(head, tail)
      };
    }
