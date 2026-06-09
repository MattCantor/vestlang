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

  // One partition for the whole grant — the program is collapsed before it's
  // split into vested / unvested / impossible.
  console.log(`AS OF ${result.asOf}`);
  if (result.vested.length > 0) {
    console.log("VESTED");
    console.table(result.vested);
  }
  if (result.unvested.length > 0) {
    console.log("UNVESTED");
    console.table(result.unvested);
  }
  if (result.impossible.length > 0) {
    console.log("IMPOSSIBLE");
    console.table(result.impossible);
  }
  console.log("UNRESOLVED");
  console.log(result.unresolved);
  console.log("SUMMARY");
  console.table(result.summary);
}
