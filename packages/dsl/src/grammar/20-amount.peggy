// Decimal literal used only for portions (0 <= x <= 1, inclusive)
// returns the raw string
Decimal
  = s:$(
    ("." [0-9]+) // .5
    / ([0-1] "." [0-9]+) // 0.x or 1.x
  ) { return s; }


// Order of priority
// 1. Decimal with "." (portion between 0 and 1 inclusive)
// 2. Fraction with "/" (integers only)
// 3. Absolute integer (quantity)

Amount = _ a:(PortionDecimal / Fraction / Quantity) _ { return a; }


// Build the portion as an exact rational straight off the digit string — no float.
// `0.333` is literally 333/1000; parseFloat + Math.round used to mask short-decimal
// float error, but it also silently rounded 18-nines up to 1/1 and let a 10^16
// denominator through. The digit-string parse refuses both instead.
PortionDecimal
  = s:Decimal {
      const [ip, fp] = s.startsWith(".") ? ["0", s.slice(1)] : s.split(".");
      // Denominator is 10^fp.length; past 15 fractional digits that's ≥ 10^16, which
      // exceeds MAX_SAFE_INTEGER (~9×10^15) and can't be held exactly as a number.
      // No matching numerator check is needed: the Decimal grammar caps the value at
      // [0,1], so once the denominator fits, numerator ≤ denominator ≤ 10^15 < MAX_SAFE.
      assertSafeInteger(10n ** BigInt(fp.length));
      const numerator = Number(ip + fp);
      const denominator = 10 ** fp.length;
      return mkPortion(numerator, denominator);
    }

Fraction = n:Integer _ "/" _ d:Integer {
  return mkPortion(n, d);
}

Quantity = n:Integer { return mkQuantity(n); }

