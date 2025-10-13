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

Amount = _ a:(Percentage / Fraction / Quantity) _ { return a; }


Percentage = s:Decimal {
      const value = parseFloat(s);
      if (s < 0 || s > 1) {
        error("Decimal portion must be between 0 and 1 inclusive");
      }
      const parts = s.startsWith(".") ? ["0", s.slice(1)] : s.split(".");
      const decimals = (parts[1] ?? "").length;
      const scale = Math.pow(10, decimals);
      const numerator = Math.round(value * scale);
      const denominator = scale;
      const g = gcd(numerator, denominator);
      return mkPortion(numerator / g, denominator / g);
    }

Fraction = n:Integer _ "/" _ d:Integer {
  if (d === 0) {
    error("Denominator cannot be 0")
  }
  const g = gcd(n, d);
  return mkPortion(n / g, d / g);
}

Quantity = n:Integer { return mkQuantity(n); }

