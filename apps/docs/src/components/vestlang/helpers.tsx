import { OCTDate } from "@vestlang/types";

export function toISODate(d: Date): OCTDate {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10) as OCTDate;
}
