import { allocation_type, Amount } from "@vestlang/types";

export function amountToQuantify(a: Amount, grantQuantity: number): number {
  return a.type === "QUANTITY"
    ? a.value
    : grantQuantity * (a.numerator / a.denominator);
}

/** Split an integer quantity across N installments according to the chosen allocation_type. */
export function allocateQuantity(
  quantity: number,
  n: number,
  mode: allocation_type,
): number[] {
  if (n <= 0) return [];

  switch (mode) {
    case "CUMULATIVE_ROUNDING": {
      const out = new Array<number>(n).fill(0);
      for (let i = 0; i < n; i++) {
        const prev = i === 0 ? 0 : out.slice(0, i).reduce((a, b) => a + b, 0);
        const target = Math.round(((i + 1) / n) * quantity);
        out[i] = target - prev;
      }
      return out;
    }

    case "CUMULATIVE_ROUND_DOWN": {
      const out = new Array<number>(n).fill(0);
      for (let i = 0; i < n; i++) {
        const prev = i === 0 ? 0 : out.slice(0, i).reduce((a, b) => a + b, 0);
        const target = Math.floor(((i + 1) / n) * quantity);
        out[i] = target - prev;
      }
      return out;
    }

    case "FRONT_LOADED": {
      const base = Math.floor(quantity / n);
      const remainder = quantity % n;
      return Array.from({ length: n }, (_, i) =>
        i < remainder ? base + 1 : base,
      );
    }

    case "BACK_LOADED": {
      const base = Math.floor(quantity / n);
      const remainder = quantity % n;
      return Array.from({ length: n }, (_, i) =>
        i >= n - remainder ? base + 1 : base,
      );
    }

    case "FRONT_LOADED_TO_SINGLE_TRANCHE": {
      const base = Math.floor(quantity / n);
      const remainder = quantity % n;
      return [base + remainder, ...Array.from({ length: n - 1 }, () => base)];
    }

    case "BACK_LOADED_TO_SINGLE_TRANCHE": {
      const base = Math.floor(quantity / n);
      const remainder = quantity % n;
      return [...Array.from({ length: n - 1 }, () => base), base + remainder];
    }

    default:
      return Array.from({ length: n }, () => Math.floor(quantity / n));
  }
}
