import { parseQuantity, validateDate, runAsOf } from "@vestlang/pipeline";
import { input, fail } from "./utils.js";

export function asof(
  parts: string[],
  opts: {
    quantity: string;
    grantDate: string;
    date?: string;
    event: Record<string, string>;
    stdin?: boolean;
  },
): void {
  const quantity = parseQuantity(opts.quantity);
  if (!quantity.ok) fail(quantity.error);
  const grantDate = validateDate(opts.grantDate);
  if (!grantDate.ok) fail(grantDate.error);

  // --date is optional; when omitted, runAsOf cuts off as of today.
  let asOf: string | undefined;
  if (opts.date !== undefined) {
    const date = validateDate(opts.date);
    if (!date.ok) fail(date.error);
    asOf = date.date;
  }

  const grant = {
    grant_date: grantDate.date,
    grant_quantity: quantity.quantity,
    events: opts.event,
  };

  const result = runAsOf(input(parts, opts.stdin), grant, asOf);
  if (!result.ok) fail(result.error);

  console.log(`AS OF ${result.asOf}`);
  result.statements.forEach((r) => {
    if (r.vested.length > 0) {
      console.log("VESTED");
      console.table(r.vested);
    }
    if (r.unvested.length > 0) {
      console.log("UNVESTED");
      console.table(r.unvested);
    }
    if (r.impossible.length > 0) {
      console.log("IMPOSSIBLE");
      console.table(r.impossible);
    }
    console.log("UNRESOLVED");
    console.log(r.unresolved);
    console.log("SUMMARY");
    console.table(r.summary);
  });
}
