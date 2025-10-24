import { OCTDate } from "@vestlang/types";
import { readFileSync } from "node:fs";

function readAllStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function input(parts: string[], stdin?: boolean): string {
  return stdin ? readAllStdin() : parts.join(" ");
}

export function getTodayISO(): OCTDate {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}` as OCTDate;
}

export function validateDate(input: string): OCTDate {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  if (!dateRegex.test(input)) {
    console.error("Invalid date format. Use YYYY-MM-DD.");
    process.exit(1);
  }

  return input as OCTDate;
}
