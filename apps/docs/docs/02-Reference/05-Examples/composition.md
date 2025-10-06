---
title: Composition
sidebar_position: 5
---

# Top-level Composition

At the top level, you can combine **entire schedules** using `EARLIER OF` or `LATER OF`. This is useful when vesting should track the fastest or slowest of multiple parallel schedules.


## EARLIER OF (Schedule, Schedule)

```vest
VEST EARLIER OF (
  SCHEDULE FROM DATE 2025-01-01 OVER 12 months EVERY 1 month,
  SCHEDULE FROM DATE 2025-06-01
)
```

---

## LATER OF (Schedule, Schedule)

```vest
VEST LATER OF (
  SCHEDULE FROM DATE 2025-01-01,
  SCHEDULE FROM DATE 2025-06-01 OVER 6 months EVERY 1 month
)
```

---

:::note
## Robust commas/whitespace

```vest
VEST EARLIER OF ( SCHEDULE, SCHEDULE ,  SCHEDULE )
```
:::
