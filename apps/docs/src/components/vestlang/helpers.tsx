import { OCTDate, Program } from "@vestlang/types";

export function toISODate(d: Date): OCTDate {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10) as OCTDate;
}

export const getVestingEvents = (ast: Program): string[] => {
  const vestingEvents: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      if (rec.type === "EVENT" && typeof rec.value === "string") {
        vestingEvents.push(rec.value);
      }
      for (const v of Object.values(rec)) visit(v);
    }
  };
  visit(ast);
  return vestingEvents;
};
