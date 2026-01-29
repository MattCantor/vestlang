# Vestlang

> **A domain-specific language for modeling vesting schedules**

[Docs](https://mattcantor.github.io/vestlang/)

---

## 📦 Packages

| Package                              | Description                                                      |
| ------------------------------------ | ---------------------------------------------------------------- |
| `@vestlang/dsl`                      | PEG grammar & parser                                             |
| `@vestlang/normalizer`               | Converts parsed grammar in normalized AST                        |
| `@vestlang/evaluator`                | Creates a vesting schedule from the normalized AST with metadata |
| `@vestlang/cli`                      | CLI for running and testing DSL examples                         |
| `@vestlang/prettier-plugin-vestlang` | autoformatting                                                   |
| `@vestlang/linter`                   | syntax errors                                                    |
| `@vestlang/types`                    | types                                                            |

---

## CLI Usage

Evaluate a vesting schedule from the command line:

```bash
# Basic usage
node apps/cli/dist/index.js evaluate -q 100 -g 2025-01-01 "VEST OVER 4 years EVERY 3 months CLIFF 12 months"

# With stdin
echo 'VEST OVER 4 years EVERY 3 months CLIFF 12 months' | \
  node apps/cli/dist/index.js evaluate -q 100 -g 2025-01-01 --stdin

# With events
node apps/cli/dist/index.js evaluate -q 100 -g 2025-01-01 -e ipo=2026-06-15 \
  "VEST OVER 4 years EVERY 3 months CLIFF LATER OF(+12 months, EVENT ipo)"
```

**Flags:**
- `-q, --quantity <number>` — total shares granted
- `-g, --grantDate <YYYY-MM-DD>` — grant date
- `-e, --event <NAME=YYYY-MM-DD>` — supply an event (repeatable)
- `--stdin` — read DSL from stdin

**Other commands:** `inspect` (raw AST), `compile` (normalized AST), `asOf`, `lint`

---

## Examples

The following examples assume a grant date of **2025-01-01** and a grant quantity of **100 shares**.

```ts
const ctx: EvaluationContext = {
  events: { grantDate: "2025-01-01" },
  grantQuantity: 100,
  asOf: "2025-01-29", // defaults to current date
  vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
  allocation_type: "CUMULATIVE_ROUND_DOWN",
}
```

### Immediate Vesting on the Grant Date

All shares vest immediately on the grant date

| Amount | Date       |
| :----- | :--------- |
| 100    | 2025-01-01 |

#### AST

```json
{
  "amount": {
    "type": "PORTION",
    "numerator": 1,
    "denominator": 1
  },
  "expr": {
    "type": "SINGLETON",
    "vesting_start": null,
    "periodicity": {
      "type": "DAYS",
      "length": 0,
      "occurrences": 1
    }
  }
}
```

#### Vestlang

```vest
VEST
```

### 4-Year Monthly Vesting

Shares vest monthly over four years with no cliff, commencing on the grant date.

| Amount | Date       |
| :----- | :--------- |
| 2      | 2025-02-01 |
| 2      | 2025-03-01 |
| 2      | 2025-04-01 |
| 2      | 2025-05-01 |
| 2      | 2025-06-01 |
| 2      | 2025-07-01 |
| 2      | 2025-08-01 |
| 2      | 2025-09-01 |
| 2      | 2025-10-01 |
| 2      | 2025-11-01 |
| 2      | 2025-12-01 |
| 3      | 2026-01-01 |
| 2      | 2026-02-01 |
| 2      | 2026-03-01 |
| 2      | 2026-04-01 |
| 2      | 2026-05-01 |
| 2      | 2026-06-01 |
| 2      | 2026-07-01 |
| 2      | 2026-08-01 |
| 2      | 2026-09-01 |
| 2      | 2026-10-01 |
| 2      | 2026-11-01 |
| 2      | 2026-12-01 |
| 3      | 2027-01-01 |
| 2      | 2027-02-01 |
| 2      | 2027-03-01 |
| 2      | 2027-04-01 |
| 2      | 2027-05-01 |
| 2      | 2027-06-01 |
| 2      | 2027-07-01 |
| 2      | 2027-08-01 |
| 2      | 2027-09-01 |
| 2      | 2027-10-01 |
| 2      | 2027-11-01 |
| 2      | 2027-12-01 |
| 3      | 2028-01-01 |
| 2      | 2028-02-01 |
| 2      | 2028-03-01 |
| 2      | 2028-04-01 |
| 2      | 2028-05-01 |
| 2      | 2028-06-01 |
| 2      | 2028-07-01 |
| 2      | 2028-08-01 |
| 2      | 2028-09-01 |
| 2      | 2028-10-01 |
| 2      | 2028-11-01 |
| 2      | 2028-12-01 |
| 3      | 2029-01-01 |

#### Vestlang

```vest
100 VEST
  OVER 48 months EVERY 1 months
```

### 4-Year Quarterly Vesting with 1-Year Cliff

Shares vest quarterly over 4 years commencing from the grant date, but nothing vests until the 1-year cliff is reached.

| Amount | Date       |
| :----- | :--------- |
| 25     | 2026-01-01 |
| 6      | 2026-04-01 |
| 6      | 2026-07-01 |
| 6      | 2026-10-01 |
| 7      | 2027-01-01 |
| 6      | 2027-04-01 |
| 6      | 2027-07-01 |
| 6      | 2027-10-01 |
| 7      | 2028-01-01 |
| 6      | 2028-04-01 |
| 6      | 2028-07-01 |
| 6      | 2028-10-01 |
| 7      | 2029-01-01 |

#### AST

```json
{
  "amount": {
    "type": "QUANTITY",
    "value": 100
  },
  "expr": {
    "type": "SINGLETON",
    "vesting_start": null,
    "periodicity": {
      "type": "MONTHS",
      "length": 3,
      "occurrences": 16,
      "cliff": {
        "type": "DURATION",
        "value": 12,
        "unit": "MONTHS",
        "sign": "PLUS"
      }
    }
  }
}
```

#### Vestlang

```vest
100 VEST
  OVER 4 years EVERY 3 months
  CLIFF 12 months
```

### Milestone-Based Vesting

Vesting is contingent on an event (e.g., achieving a product milestone). The schedule remains unresolved until the event occurs.

| Amount | Date                                |
| :----- | :---------------------------------- |
| 100    | `{ type: UNRESOLVED_VESTING_START}` |

#### AST

```json
{
    "amount": {
      "type": "QUANTITY",
      "value": 100
    },
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

#### Vestlang

```vest
100 VEST FROM EVENT milestone
```

### Backdated Vesting Start

Awards granted with a vesting start that precedes the grant date, providing credit for services already rendered. Installments before the grant date are accumulated and vest on the grant date.

| Amount | Date       |
| :----- | :--------- |
| 25     | 2025-01-01 |
| 6      | 2025-04-01 |
| 6      | 2025-07-01 |
| 6      | 2025-10-01 |
| 7      | 2026-01-01 |
| ...    | ...        |

#### AST

```json
{
    "amount": {
      "type": "QUANTITY",
      "value": 100
    },
    "expr": {
      "type": "SINGLETON",
      "vesting_start": {
        "type": "SINGLETON",
        "base": {
          "type": "DATE",
          "value": "2024-01-01"
        },
        "offsets": []
      },
      "periodicity": {
        "type": "MONTHS",
        "length": 3,
        "occurrences": 16
      }
    }
  }
```

#### Vestlang

```vest
100 VEST FROM DATE 2024-01-01
  OVER 4 years EVERY 3 months
```

### Back-Weighted Vesting (Amazon-style)

A back-weighted schedule where more shares vest in later years. This example uses Amazon's 5/15/40/40 pattern over 4 years.

| Amount | Date       |
| :----- | :--------- |
| 5      | 2026-01-01 |
| 15     | 2027-01-01 |
| 40     | 2028-01-01 |
| 40     | 2029-01-01 |

#### AST

Each portion is a separate statement. The normalized AST converts decimals to fractions (e.g., 0.05 → 1/20, 0.15 → 3/20, 0.40 → 2/5):

```json
[
  {
    "amount": { "type": "PORTION", "numerator": 1, "denominator": 20 },
    "expr": {
      "type": "SINGLETON",
      "vesting_start": {
        "type": "SINGLETON",
        "base": { "type": "EVENT", "value": "grantDate" },
        "offsets": [{ "type": "DURATION", "value": 12, "unit": "MONTHS", "sign": "PLUS" }]
      },
      "periodicity": { "type": "DAYS", "length": 0, "occurrences": 1 }
    }
  }
]
```

_(AST truncated — 3 more statements for 15%, 40%, 40% with offsets of 24, 36, and 48 months respectively)_

#### Vestlang

```vest
[
  0.05 VEST FROM +12 months,
  0.15 VEST FROM +24 months,
  0.40 VEST FROM +36 months,
  0.40 VEST FROM +48 months
]
```

### Bespoke Vesting with Variable Cadence

A custom schedule where different tranches vest at different cadences. This example vests 50% monthly over 2 years, then 50% quarterly over 3 years.

**Monthly tranche (50%):**

| Amount | Date |
| :----- | :--------- |
| 2 | 2025-02-01 |
| 2 | '2025-03-01 |
| 2 | 2025-04-01 |
| 2 | 2025-05-01 |
| 2 | 2025-06-01 |
| 2 | 2025-07-01 |
| 2 | 2025-08-01 |
| 2 | 2025-09-01 |
| 2 | 2025-10-01 |
| 2 | 2025-11-01 |
| 2 | 2025-12-01 |
| 3 | 2026-01-01 |
| 2 | 2026-02-01 |
| 2 | 2026-03-01 |
| 2 | 2026-04-01 |
| 2 | 2026-05-01 |
| 2 | 2026-06-01 |
| 2 | 2026-07-01 |
| 2 | 2026-08-01 |
| 2 | 2026-09-01 |
| 2 | 2026-10-01 |
| 2 | 2026-11-01 |
| 2 | 2026-12-01 |
| 3 | 2027-01-01 |

**Quarterly tranche (50%):**

| Amount | Date       |
| :----- | :--------- |
| 4      | 2027-04-01 |
| 4      | 2027-07-01 |
| 4      | 2027-10-01 |
| 4      | 2028-01-01 |
| 4      | 2028-04-01 |
| 5      | 2028-07-01 |
| 4      | 2028-10-01 |
| 4      | 2029-01-01 |
| 4      | 2029-04-01 |
| 4      | 2029-07-01 |
| 4      | 2029-10-01 |
| 5      | 2030-01-01 |

#### AST

```json
[
  {
    "amount": {
      "type": "PORTION",
      "numerator": 1,
      "denominator": 2
    },
    "expr": {
      "type": "SINGLETON",
      "vesting_start": null,
      "periodicity": {
        "type": "MONTHS",
        "length": 1,
        "occurrences": 24
      }
    }
  },
  {
    "amount": {
      "type": "PORTION",
      "numerator": 1,
      "denominator": 2
    },
    "expr": {
      "type": "SINGLETON",
      "vesting_start": {
        "type": "DURATION",
        "value": 24,
        "unit": "MONTHS",
        "sign": "PLUS"
      },
      "periodicity": {
        "type": "MONTHS",
        "length": 3,
        "occurrences": 12
      }
    }
  }
]
```

#### Vestlang

```vest
[
  0.50 VEST OVER 24 months EVERY 1 month,
  0.50 VEST FROM +24 months OVER 36 months EVERY 3 months
]
```

### Two-Tier Vesting

A 4-year quarterly vesting schedule with two cliff conditions: a standard 1-year time-based cliff, plus an event-based cliff requiring either an IPO or change in control (CIC) before the 7th anniversary of the grant date.

| Amount | Date |
| :----- | :----------- |
| 25 | {"type":"UNRESOLVED_CLIFF","date":"2026-01-01"} |
| 6 | {"type":"UNRESOLVED_CLIFF","date":"2026-04-01"} |
| 6 | {"type":"UNRESOLVED_CLIFF","date":"2026-07-01"} |
| 6 | {"type":"UNRESOLVED_CLIFF","date":"2026-10-01"} |
| 7 | {"type":"UNRESOLVED_CLIFF","date":"2027-01-01"} |
| 6 | {"type":"UNRESOLVED_CLIFF","date":"2027-04-01"} |
| 6 | {"type":"UNRESOLVED_CLIFF","date":"2027-07-01"} |
| 6 | {"type":"UNRESOLVED_CLIFF","date":"2027-10-01"} |
| 7 | {"type":"UNRESOLVED_CLIFF","date":"2028-01-01"} |
| 6 | {"type":"UNRESOLVED_CLIFF","date":"2028-04-01"} |
| 6 | {"type":"UNRESOLVED_CLIFF","date":"2028-07-01"} |
| 6 | {"type":"UNRESOLVED_CLIFF","date":"2028-10-01"} |
| 7 | {"type":"UNRESOLVED_CLIFF","date":"2029-01-01"} |

The time-based cliff is applied (first 12 months accumulate to 25 shares), but installments remain unresolved until the IPO or CIC event occurs.

#### AST

```json
{
    "amount": {
      "type": "PORTION",
      "numerator": 1,
      "denominator": 1
    },
    "expr": {
      "type": "SINGLETON",
      "vesting_start": null,
      "periodicity": {
        "type": "MONTHS",
        "length": 3,
        "occurrences": 16,
        "cliff": {
          "type": "LATER_OF",
          "items": [
            {
              "type": "DURATION",
              "value": 12,
              "unit": "MONTHS",
              "sign": "PLUS"
            },
            {
              "type": "EARLIER_OF",
              "items": [
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
                },
                {
                  "type": "SINGLETON",
                  "base": {
                    "type": "EVENT",
                    "value": "cic"
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

#### Vestlang

```vest
VEST
  OVER 4 years EVERY 3 months
  CLIFF LATER OF(
    +12 months,
    EARLIER OF(
      EVENT ipo BEFORE EVENT grantDate +7 years,
      EVENT cic BEFORE EVENT grantDate +7 years
    )
  )
```

#### With IPO Event Resolved

When the IPO occurs within the 7-year window (e.g., `ipo=2026-06-15`), the cliff resolves to the later of the two conditions: the 12-month cliff (2026-01-01) vs the IPO date (2026-06-15). Since the IPO is later, all installments through that date accumulate and vest on the IPO date.

| Amount | Date       |
| :----- | :--------- |
| 31     | 2026-06-15 |
| 6      | 2026-07-01 |
| 6      | 2026-10-01 |
| 7      | 2027-01-01 |
| 6      | 2027-04-01 |
| 6      | 2027-07-01 |
| 6      | 2027-10-01 |
| 7      | 2028-01-01 |
| 6      | 2028-04-01 |
| 6      | 2028-07-01 |
| 6      | 2028-10-01 |
| 7      | 2029-01-01 |
