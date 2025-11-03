---
title: Schedule Basics
sidebar_position: 2
---

# Schedule Basics

A **Schedule** describes cadence (`OVER`/`EVERY`) and optional anchors (`FROM`, `CLIFF`). The grammar enforces that `OVER` and `EVERY` appear **together**. Units are normalized to simplify downstream logic.

:::note
## Schedule with omitted OVER/EVERY

```vest
VEST SCHEDULE FROM DATE 2026-01-01
```

The grammar injects **zero** durations for `over` and `every`:

```json
{
  "over":  { "type": "Duration", "value": 0, "unit": "DAYS" },
  "every": { "type": "Duration", "value": 0, "unit": "DAYS" }
}
```

Zero durations can alternative be provided explicity
```vest
VEST SCHEDULE OVER 0 days EVERY 0 days
```

:::

---

:::note
## Unit normalization (years→months, weeks→days)

```vest
VEST SCHEDULE OVER 2 years EVERY 1 week
```

Normalized durations:

```json
{
  "over":  { "type": "Duration", "value": 24, "unit": "MONTHS" },
  "every": { "type": "Duration", "value": 7,  "unit": "DAYS" }
}
```

:::

---

:::warning
## Error: OVER without EVERY

```vest
VEST SCHEDULE OVER 12 months
```

Expected error:

```
EVERY must be provided when OVER is present
```

:::

---

:::warning
## Error: EVERY without OVER

```vest
VEST SCHEDULE EVERY 1 month
```

Expected error:

```
OVER must be provided when EVERY is present
```
:::
