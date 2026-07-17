import { daysInMonth } from "@vestlang/utils";
import { RuleModule } from "../types.js";

const meta = {
  id: "ambiguous-month-end-start",
  description:
    "A literal month-end start on a 30-day month (or February) under a sub-annual monthly cadence lands later tranches on the same day number, not on the last day of longer months, unless the day-of-month convention is set to LAST_DAY_OF_MONTH.",
  recommended: true,
  severity: "info" as const,
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const ruleAmbiguousMonthEndStart: RuleModule = {
  meta,
  create(ctx) {
    const { id, severity } = meta;
    return {
      SCHEDULE(node, path) {
        // A THEN-chained tail continues from the previous segment's end and has
        // no start of its own (`vesting_start` is null) — nothing to anchor on.
        const start = node.vesting_start;
        if (!start) return;

        // Only a single literal DATE anchor, read exactly as written. A selector
        // (LATER OF / EARLIER OF) isn't a `NODE`; an offset or a start gate both
        // move the effective anchor off the typed date, so the day the author
        // wrote is no longer the one the schedule vests on.
        if (start.type !== "NODE" || start.base.type !== "DATE") return;
        if (start.offsets.length !== 0 || start.condition !== undefined) return;

        // Whole-year steps (12, 24, …) always revisit the anchor's own month, so
        // a month-end start never diverges under them. Only a sub-annual monthly
        // cadence can drift onto a shorter month's smaller last day. (There is no
        // YEARS unit — the grammar rewrites `every 1 year` to `every 12 months`.)
        const { type, length } = node.periodicity;
        if (type !== "MONTHS" || length % 12 === 0) return;

        // The literal is an already-validated YYYY-MM-DD, so read the parts
        // straight off the string.
        const [year, month, day] = start.base.value.split("-").map(Number);

        // Fire only when the date is its month's last day and that last day is
        // below 31. A 31-day month already clamps every tranche to its true end
        // under the default convention, so it needs no nudge; the 28th/29th/30th
        // month-ends are the ones later tranches under-shoot.
        const lastDay = daysInMonth(year, month);
        if (day !== lastDay || lastDay === 31) return;

        ctx.report({
          ruleId: id,
          message: `Start date ${start.base.value} is the last day of ${MONTH_NAMES[month - 1]}. If you are relying on the default day-of-month convention (VESTING_START_DAY), later tranches pin to day ${day} and will not roll to the last day of longer months. To vest on the last day of each month, set the day-of-month convention to LAST_DAY_OF_MONTH explicitly.`,
          severity,
          path: path.concat("vesting_start"),
        });
      },
    };
  },
};
