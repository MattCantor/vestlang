---
title: Vesting Start
sidebar_position: 3
---
# Vesting Start

`FROM` determines the **vesting start anchor**. It can be a date, an event, a qualified anchor with temporal predicates, or a combinator over multiple anchors.

:::note
If `FROM` is omitted, the grammar injects a default `EVENT grantDate` to be supplied downstream
```json
{}
```
:::

## From Date

```vest
VEST SCHEDULE FROM DATE 2027-01-01
```

---

## From Event

```vest
VEST SCHEDULE FROM EVENT ipo
```

---

## From EARLIER OF (...)

```vest
VEST SCHEDULE FROM EARLIER OF (DATE 2026-06-01, EVENT cic)
```

This chooses the **earliest** among the provided anchors.

---

## From LATER OF (...)

```vest
VEST SCHEDULE FROM LATER OF (EVENT ipo, DATE 2026-01-01)
```

This chooses the **latest** among the provided anchors.

---

## Qualified BEFORE

```vest
VEST SCHEDULE FROM DATE 2025-01-01 BEFORE EVENT cic
```

Meaning: the date is only valid if it occurs **on/before** `EVENT cic`.

---

## Qualified STRICTLY BEFORE

```vest
VEST SCHEDULE FROM DATE 2025-01-01 STRICTLY BEFORE EVENT cic
```

Meaning: the date is only valid if it occurs **before** (exclusive) `EVENT cic`.

---

## Qualified AFTER

```vest
VEST SCHEDULE FROM EVENT ipo AFTER DATE 2026-01-01
```

Meaning: the event is only valid if it occurs **on/after** that date.

---

## Qualified BETWEEN

```vest
VEST SCHEDULE FROM EVENT board BETWEEN DATE 2025-01-01 AND DATE 2025-12-31
```

Meaning: the event must occur **within** that window (inclusive by default).

---

## Qualified STRICTLY BETWEEN

```vest
VEST SCHEDULE FROM EVENT board STRICTLY BETWEEN DATE 2025-01-01 AND DATE 2025-12-31
```

Meaning: the event must occur **strictly within** the window (exclusive ends).

