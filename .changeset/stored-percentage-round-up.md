---
"@vestlang/vestlang": patch
"@vestlang/mcp-server": patch
---

Schedules whose shares are exact whole numbers of shares now vest those whole numbers.
A vesting percentage is written to storage as a ten-place decimal, and it used to be
cut short there — so a third of a 30,000-share grant stored as `0.3333333333` and paid
9,999 on the cliff, and `19/48 VEST … THEN 29/48 VEST …` of 48,000 paid 18,999 where
19,000 was exact. Percentages now round up to the ten-place grid instead, which the
share math's rounding-down absorbs: `VEST OVER 3 years EVERY 1 year CLIFF 1 year` over
30,000 shares vests 10,000 a year, and the 19/48 split pays its 19,000.

Multi-statement schedules are written as running totals rounded to the grid, so the
set still adds up to exactly what was authored — a schedule that leaves shares
unvested keeps leaving them, and one that over-allocates is still refused rather than
reshaped. A single tranche can now land one share high (and a later one one share low)
at grants above roughly a billion shares; the schedule total is unaffected.

The `precision-insufficient` warning is correspondingly quieter. It no longer fires
where the stored decimal now lands the right count, and no longer recommends a
replacement decimal — a value that lands one grant is wrong at the next, and a stored
template carries no grant. It still fires where ten places genuinely cannot express the
schedule at the grant size, and still warns conservatively for a cliff lump whose
realized size depends on what vests before it.
