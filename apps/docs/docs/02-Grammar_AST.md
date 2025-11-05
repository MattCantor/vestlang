---
title: DSL Grammar and AST
sidebar_position: 2
---

## DSL Recipe

The DSL accepts the following recipe:

```
[ amount ] VEST
    [ FROM <vesting-expr> [ OVER <duration> EVERY <duration> ] ]
    [ CLIFF <vesting-expr> ]
```

:::tip
Keywords are case-insensitive
:::

### Vesting Expressions

A vesting-expr is either a singleton vesting node (described below), or a selector over vesting expressions:

```
( EARLIER OF | LATER OF ) (
    <vesting-expr>,
    <vesting-expr>
    [, <vesting-expr>...]
)
```

A singleton vesting node is a date literal or an event, with optional conditions.

```
( DATE <iso> | EVENT <string> ) [condition]
```

| Node  | Pattern                                         |
| :---- | :---------------------------------------------- |
| Date  | ([0-9][0-9][0-9] "-" [0-1][0-9] "-" [0-3][0-9]) |
| Event | ([A-Za-z\_][A-Za-z0-9_]\*)                      |

### Conditions

A singleton condition is described as follows:

```
[ ( BEFORE | AFTER )
    ( DATE <iso> | EVENT <string> ) [ ( + | - ) <duration> ] ]
```

Singleton conditions may be chained with `AND` and `OR` operators...

```
<condition> AND <condition> OR <condition>
```

...or grouped with parentheses.

```
(AND | OR) (
    <condition>,
    <condition>,
    [, condition...]
)
```

### Duration

A duration is given by the following:

```
<number> (year|years|month|months|week|weeks|day|days)
```

### Amount

An amount can be provided with a decimal, indicating a portion between 0 and 1 inclusive...

```
0.5 VEST OVER 4 years EVERY 1 month
```

...as a fraction, indicating a portion of the total quantity applicable to the security...

```
1/2 VEST OVER 4 years EVERY 1 month
```

...or as an interger, indicating an absolute number of shares.

```
100 VEST OVER 4 years EVERY 1 month
```

## Abstract Syntax Tree

The DSL compiles into an abstract syntax tree describing the following:

### Periodic Vesting Cadence

The fundamental component of a vesting schedule is a periodic sequence of vesting installments. In order to derive this periodic sequence one needs a **number of installments** and the **duration of the step between each installment**.

The **duration of the step between each installment** is given by `EVERY <duration>` in the grammar.

In order to target natural language in the DSL, we derive the **number of installments** from the **overall length of the periodic sequence**, which is given by `OVER <duration>` in the grammar.

:::note
The grammar enforces that `OVER` and `EVERY` appear together. Neither can be provided without the other. If both are omitted, a duration of 0 days with 1 occurrence is injected, indicating automatic vesting on the resolved vesting start date.

Years are converted to months and weeks are converted to days in the normalized AST. `OVER` and `EVERY` must have the same base unit (months or days).
:::

#### Example: Periodic Vesting Cadence With Year -> Month Conversion

```
VEST OVER 4 years EVERY 1 month
```

```json
{
  "expr": {
    "periodicity": {
      "type": "MONTHS",
      "length": 1,
      "occurrences": 48
    }
  }
}
```

#### Example: Omitted OVER/EVERY

```
VEST
```

```json
{
  "expr": {
    "periodicity": {
      "type": "DAYS",
      "length": 0,
      "occurrences": 1
    }
  }
}
```

### Vesting start

Each periodic sequence of vesting installments requires a vesting start date from which to calculate the series of installments.

The vesting-start is given by `FROM <vesting-expr>`, as described [above](#vesting-expressions). The vesting start may be omitted, in which case it is assumed to be the grant date of the security.

:::warning
`EVENT vestingStart` is a system event that is derived during the normalization process. This is necessary so that the cliff can refer back to the resolved vesting start.

However, this means that `EVENT vestingStart` may not be used in the `FROM <vesting-expr`, and doing so will throw an error.
:::

#### Example: Omitted Vesting Start

```
VEST
```

```json
{
  "expr": {
    "type": "SINGLETON",
    "vesting_start": {
      "type": "SINGLETON",
      "base": {
        "type": "EVENT",
        "value": "grantDate"
      },
      "offsets": []
    },
    "periodicity": {
      "type": "DAYS",
      "length": 0,
      "occurrences": 1
    }
  }
}
```

#### Example: Vesting Start with Event

```
VEST FROM EVENT milestone
```

```json
{
  "expr": {
    "type": "SINGLETON",
    "vesting_start": {
      "type": "SINGLETON",
      "base": {
        "type": "EVENT",
        "value": "milestone"
      },
      "offsets": []
    },
    "periodicity": {
      "type": "DAYS",
      "length": 0,
      "occurrences": 1
    }
  }
}
```

### Cliff accrual

Another common feature of vesting schedules is the concept of a "cliff". When a cliff applies, all vesting installments prior to the cliff are accrued and accumulated until the cliff occurs.

A cliff only applies in the context of a periodic sequence of vesting installments.

:::note
By convention, a duration within a Cliff is understood to refer to the resolved vesting start.
:::

#### Example: Simple Cliff

```
VEST OVER 4 years EVERY 1 month CLIFF 12 months
```

```json
{
  "expr": {
    "type": "SINGLETON",
    "vesting_start": {
      "type": "SINGLETON",
      "base": {
        "type": "EVENT",
        "value": "grantDate"
      },
      "offsets": []
    },
    "periodicity": {
      "type": "MONTHS",
      "length": 1,
      "occurrences": 48,
      "cliff": {
        "type": "SINGLETON",
        "base": {
          "type": "EVENT",
          "value": "vestingStart"
        },
        "offsets": [
          {
            "type": "DURATION",
            "value": 12,
            "unit": "MONTHS",
            "sign": "PLUS"
          }
        ]
      }
    }
  }
}
```

### Selectors

Selectors select between alternative expressions.

Given the temporal aspect of vesting schedules, a selector can be thought of as either choosing the `EARLIER OF` or `LATER OF` given items. In the case of an `EARLIER OF` selector, the first item to occur is selected. In the case of a `LATER OF` selector, both items must occur, and the later of the items is selected.

Note that in this way `EARLIER OF` acts as an OR logical operator and `LATER OF` acts as an AND logical operator. However, we have purposefully limited ourselves to the `EARLIER OF` and `LATER OF` nomenclature in order to distinguish selectors from conditions, described below.

#### Example: Vesting Start With Selector

```
VEST FROM EARLIER OF (
    DATE 2025-01-01,
    EVENT milestone
)
```

```json
{
  "expr": {
    "type": "SINGLETON",
    "vesting_start": {
      "type": "EARLIER_OF",
      "items": [
        {
          "type": "SINGLETON",
          "base": {
            "type": "DATE",
            "value": "2025-01-01"
          },
          "offsets": []
        },
        {
          "type": "SINGLETON",
          "base": {
            "type": "EVENT",
            "value": "milestone"
          },
          "offsets": []
        }
      ]
    },
    "periodicity": {
      "type": "DAYS",
      "length": 0,
      "occurrences": 1
    }
  }
}
```

#### Example: Cliff with Selector

```
VEST
    OVER 4 years
    EVERY 1 month
    CLIFF EARLIER OF (
        12 months,
        EVENT ipo
    )
```

```json
{
  "expr": {
    "type": "SINGLETON",
    "vesting_start": {
      "type": "SINGLETON",
      "base": {
        "type": "EVENT",
        "value": "grantDate"
      },
      "offsets": []
    },
    "periodicity": {
      "type": "MONTHS",
      "length": 1,
      "occurrences": 48,
      "cliff": {
        "type": "EARLIER_OF",
        "items": [
          {
            "type": "SINGLETON",
            "base": {
              "type": "EVENT",
              "value": "ipo"
            },
            "offsets": []
          },
          {
            "type": "SINGLETON",
            "base": {
              "type": "EVENT",
              "value": "vestingStart"
            },
            "offsets": [
              {
                "type": "DURATION",
                "value": 12,
                "unit": "MONTHS",
                "sign": "PLUS"
              }
            ]
          }
        ]
      }
    }
  }
}
```

### Conditions

Conditons condition one vesting expression on the occurrence of another.

We again leverage the temporal aspect of vesting schedules in order to limit ourselves to `BEFORE` and `AFTER` nomenclature. Any condition can optionally utilize the `STRICTLY` keyword to indicate < or >, respectively.

In addition, conditions can be combined with `AND` and `OR` operators. We follow SQL like precedence (`AND` binds tighter than `OR`, and parentheses override precedence).

```
VEST FROM EVENT milestone
    STRICTLY BEFORE DATE 2025-01-01 AND
    AFTER EVENT threshold
```

```json
{
  "expr": {
    "type": "SINGLETON",
    "vesting_start": {
      "type": "SINGLETON",
      "base": {
        "type": "EVENT",
        "value": "milestone"
      },
      "offsets": [],
      "constraints": {
        "type": "AND",
        "items": [
          {
            "type": "ATOM",
            "constraint": {
              "type": "BEFORE",
              "base": {
                "type": "SINGLETON",
                "base": {
                  "type": "DATE",
                  "value": "2025-01-01"
                },
                "offsets": []
              },
              "strict": true
            }
          },
          {
            "type": "ATOM",
            "constraint": {
              "type": "AFTER",
              "base": {
                "type": "SINGLETON",
                "base": {
                  "type": "EVENT",
                  "value": "threshold"
                },
                "offsets": []
              },
              "strict": false
            }
          }
        ]
      }
    },
    "periodicity": {
      "type": "DAYS",
      "length": 0,
      "occurrences": 1
    }
  }
}
```

### Amounts

In vestlang the _thing_ that the vesting schedule applies to is left ambiguous. For purposes of this documentation we have discussed vesting schedules in terms of equity-based compensation awards, but in practice it could apply to anything.

Amounts specify **how much** of the grant a statement applies to. Integers imply absolute amounts, decimals in [0, 1] imply a percentage, and fractions imply a portion of total statement amount, supplied downstream. If amount is omitted, the default is 100% (1.0)

#### Example: Omitted Amount

```
VEST
```

```json
{
  "amount": {
    "type": "PORTION",
    "numerator": 1,
    "denominator": 1
  }
}
```

#### Example: Integer Amount

```
100 VEST
```

```json
{
  "amount": {
    "type": "QUANTITY",
    "value": 100
  }
}
```

#### Example: Decimal Amount

```
0.5 VEST
```

```json
{
  "amount": {
    "type": "PORTION",
    "numerator": 1,
    "denominator": 2
  }
}
```

#### Example: Fraction Amount

```
1/2 VEST
```

```json
{
  "amount": {
    "type": "PORTION",
    "numerator": 1,
    "denominator": 2
  }
}
```

### Two-Tier Vesting Example

We can demonstrate the expressiveness of the vestlang DSL and AST by constructing a statement which describes a **two-tier vesting schedule**.

Two-tier vesting refers to a periodic vesting cadence with a standard time-based cliff, as well as one or more event-based cliffs with expiration dates.

The standard two-tier vesting schedule seen in the wild is a 4-year monthly vesting schedule with a 1-year cliff, as well as a cliff on the earlier of an IPO or change in control, so long as the IPO or change in control occurs on prior to the 7th anniversary of the grant date.

This is expressed in vestlang DSL as follows. Note that the `12 months` duration in the cliff statement refers to the resolved vesting start, and we use the `EVENT grantDAte` system event to provide the expiration dates for the cliffs.

```vest
VEST
    OVER 4 years
    EVERY 1 month
    CLIFF LATER OF (
        12 months,
        EARLIER OF (
            EVENT ipo
                BEFORE EVENT grantDate + 7 years,
            EVENT cic
                BEFORE EVENT grantDate + 7 years
        )
    )
```

```json
{
  "expr": {
    "type": "SINGLETON",
    "vesting_start": {
      "type": "SINGLETON",
      "base": {
        "type": "EVENT",
        "value": "grantDate"
      },
      "offsets": []
    },
    "periodicity": {
      "type": "MONTHS",
      "length": 1,
      "occurrences": 48,
      "cliff": {
        "type": "LATER_OF",
        "items": [
          {
            "type": "SINGLETON",
            "base": {
              "type": "EVENT",
              "value": "vestingStart"
            },
            "offsets": [
              {
                "type": "DURATION",
                "value": 12,
                "unit": "MONTHS",
                "sign": "PLUS"
              }
            ]
          },
          {
            "type": "EARLIER_OF",
            "items": [
              {
                "type": "SINGLETON",
                "base": {
                  "type": "EVENT",
                  "value": "CIC"
                },
                "offsets": [],
                "constraints": {
                  "type": "ATOM",
                  "constraint": {
                    "type": "BEFORE",
                    "base": {
                      "type": "SINGLETON",
                      "base": {
                        "type": "EVENT",
                        "value": "grantDate"
                      },
                      "offsets": [
                        {
                          "type": "DURATION",
                          "value": 84,
                          "unit": "MONTHS",
                          "sign": "PLUS"
                        }
                      ]
                    },
                    "strict": false
                  }
                }
              },
              {
                "type": "SINGLETON",
                "base": {
                  "type": "EVENT",
                  "value": "ipo"
                },
                "offsets": [],
                "constraints": {
                  "type": "ATOM",
                  "constraint": {
                    "type": "BEFORE",
                    "base": {
                      "type": "SINGLETON",
                      "base": {
                        "type": "EVENT",
                        "value": "grantDate"
                      },
                      "offsets": [
                        {
                          "type": "DURATION",
                          "value": 84,
                          "unit": "MONTHS",
                          "sign": "PLUS"
                        }
                      ]
                    },
                    "strict": false
                  }
                }
              }
            ]
          }
        ]
      }
    }
  }
}
```
