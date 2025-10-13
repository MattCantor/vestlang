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


PortionDecimal
  = s:Decimal {
      const value = parseFloat(s);
      if (value < 0 || value > 1) {
        error("Decimal portion must be between 0 and 1 inclusive");
      }
      const parts = s.startsWith(".") ? ["0", s.slice(1)] : s.split(".");
      const decimals = (parts[1] ?? "").length;
      const scale = Math.pow(10, decimals);
      const numerator = Math.round(value * scale);
      const denominator = scale;
      const g = gcd(numerator, denominator);
      return mkPortion(numerator, denominator);
    }

Fraction = n:Integer _ "/" _ d:Integer {
  return mkPortion(n, d);
}

Quantity = n:Integer { return mkQuantity(n); }

