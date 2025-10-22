import { allocation_type } from "@vestlang/types";

type VestingMode = (
  quantity: number,
  installment: number,
  denominator: string,
  numerator?: string,
) => number;

export function determineVestingMode(
  allocation_type: allocation_type,
): VestingMode {
  switch (allocation_type) {
    case "CUMULATIVE_ROUNDING":
      return (quantity: number, installment: number, denominator: string) => {
        const cumulativePercent = (installment + 1) / parseFloat(denominator);
        if (installment === 0) {
          return Math.ceil(cumulativePercent * quantity);
        }
        const lastCumulativePercent = installment / parseFloat(denominator);
        return (
          Math.ceil(cumulativePercent * quantity) -
          Math.floor(lastCumulativePercent * quantity)
        );
      };
    case "CUMULATIVE_ROUND_DOWN":
      return (quantity: number, installment: number, denominator: string) => {
        const cumulativePercent = (installment + 1) / parseFloat(denominator);
        if (installment === 0) {
          return Math.ceil(cumulativePercent * quantity);
        }
        const lastCumulativePercent = installment / parseFloat(denominator);
        return (
          Math.ceil(cumulativePercent * quantity) -
          Math.floor(lastCumulativePercent * quantity)
        );
      };
    case "FRONT_LOADED":
      return (quantity: number, installment: number, denominator: string) => {
        const remainder = quantity % parseFloat(denominator);
        if (installment < remainder) {
          return Math.ceil(quantity / parseFloat(denominator));
        }
        return Math.floor(quantity / parseFloat(denominator));
      };
    case "BACK_LOADED":
      return (quantity: number, installment: number, denominator: string) => {
        const remainder = quantity % parseFloat(denominator);
        if (installment < remainder) {
          return Math.floor(quantity / parseFloat(denominator));
        }
        return Math.ceil(quantity / parseFloat(denominator));
      };
    case "FRONT_LOADED_TO_SINGLE_TRANCHE":
      return (quantity: number, installment: number, denominator: string) => {
        const remainder = quantity % parseFloat(denominator);
        if (installment < remainder) {
          return Math.floor(quantity / parseFloat(denominator)) + remainder;
        }
        return Math.floor(quantity / parseFloat(denominator));
      };
    case "BACK_LOADED_TO_SINGLE_TRANCHE":
      return (quantity: number, installment: number, denominator: string) => {
        const remainder = quantity % parseFloat(denominator);
        if (installment < remainder) {
          return Math.floor(quantity / parseFloat(denominator)) + remainder;
        }
        return Math.floor(quantity / parseFloat(denominator));
      };
    default:
      return (quantity: number, installment, denominator, numerator = "0") =>
        (quantity * parseFloat(numerator)) / parseFloat(denominator);
  }
}
