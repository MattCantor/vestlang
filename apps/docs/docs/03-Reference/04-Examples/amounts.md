---
title: Amounts
sidebar_position: 1
---
# Amounts

:::tip
In **vestlang** the *thing* that the vesting schedule applies to is left ambiguous.  For purposes of this documentation, we will discuss vesting schedules in terms of an equity-based compensation award, but in practice it could apply to anything
:::

Amounts specify **how much** of the grant a statement applies to. Integers mean absolute shares; decimals in **[0, 1]** mean a fraction (percentage). If omitted, the default is **100% (1.0)**.

> **Why:** This mirrors real-world phrasing—“vest 100%”, “vest 0.5 (50%)”, or “vest 1,000 shares”. The parser enforces that decimal percentages stay within boundaries.

## Absolute amount

```vest
123 VEST SCHEDULE OVER 12 months EVERY 1 month
```

Expected amount node:

```json
{ "type": "AmountAbsolute", "value": 123 }
```

---

## Percent amount

```vest
0.25 VEST SCHEDULE OVER 12 months EVERY 1 month
```

Expected amount node:

```json
{ "type": "AmountPercent", "value": 0.25 }
```

---

## Leading-dot percent

```vest
.5 VEST SCHEDULE OVER 12 months EVERY 1 month
```

Expected amount node:

```json
{ "type": "AmountPercent", "value": 0.5 }
```

---

## Default 100%

```vest
VEST SCHEDULE OVER 12 months EVERY 1 month
```

Expected amount node:

```json
{ "type": "AmountPercent", "value": 1 }
```

---

## Invalid percent > 1 (error)

```vest
1.5 VEST SCHEDULE OVER 12 months EVERY 1 month
```

Expected error message includes:

```
Decimal amount must be between 0 and 1
```

