---
title: Cliffs
sidebar_position: 4
---

# Cliffs

`CLIFF` delays vesting until an additional time or anchor condition is met. It can be a **duration**, an **anchor** (date/event), a **qualified** anchor, or a **combinator**.

## Duration

```vest
VEST SCHEDULE CLIFF 6 months
```

---

## Date

```vest
VEST SCHEDULE CLIFF DATE 2026-03-01
```

---

## Qualified Anchor

```vest
VEST SCHEDULE CLIFF EVENT milestone BEFORE EVENT cic
```

---

## EARLIER OF (...)

```vest
VEST SCHEDULE CLIFF EARLIER OF (EVENT milestone, DATE 2026-01-01)
```

---

## LATER OF (...)

```vest
VEST SCHEDULE CLIFF LATER OF (EVENT milestone, DATE 2026-01-01)
```

