// Collision census over the oracle grid: how many admitted cases share an
// identical observable (aggregated projection + grantDate) with a DIFFERENT
// original template? That count is the information-theoretic clean ceiling for
// ANY inferrer (analytic or search).
//
// Run with plain `node` from the package (>=22.18 native type stripping) — the
// generator is imported in-tree, and the pipeline packages resolve to their dist
// the same way the rest of the experiments do.
import { isDeepStrictEqual } from "node:util";
import { parse } from "@vestlang/dsl";
import { evaluateProgram } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import { gridCases, SEED_CASES } from "../tests/roundtripOracle.gen.ts";

const cases = [...gridCases(), ...SEED_CASES];

function attempt(c) {
  try {
    const program = normalizeProgram(parse(c.dsl));
    const sched = evaluateProgram(program, {
      grantDate: c.grantDate,
      events: {},
      grantQuantity: c.total,
      vesting_day_of_month: c.dom,
    });
    const r = sched.resolution;
    if (r.status !== "template" || !r.installments.every((i) => i.state === "RESOLVED"))
      return null;
    const stream = r.installments.map((i) => ({ date: i.date, amount: i.amount }));
    const byDate = new Map();
    for (const { date, amount } of stream) byDate.set(date, (byDate.get(date) ?? 0) + amount);
    const proj = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return { template: r.template, proj };
  } catch {
    return null;
  }
}

const groups = new Map(); // key -> [{id, template}]
let admitted = 0;
for (const c of cases) {
  const res = attempt(c);
  if (!res) continue;
  admitted++;
  const key = c.grantDate + "::" + JSON.stringify(res.proj);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ id: c.id, template: res.template });
}

let collidingCases = 0;
let collisionClasses = 0;
let maxClass = 0;
const examples = [];
for (const [, members] of groups) {
  // distinct templates within the class
  const distinct = [];
  for (const m of members) {
    if (!distinct.some((d) => isDeepStrictEqual(d.template, m.template))) distinct.push(m);
  }
  if (distinct.length > 1) {
    collisionClasses++;
    // every case whose template is not the (hypothetically chosen) representative is doomed;
    // ceiling loss = members whose template differs from the best-represented template.
    const counts = distinct.map((d) =>
      members.filter((m) => isDeepStrictEqual(m.template, d.template)).length,
    );
    const best = Math.max(...counts);
    collidingCases += members.length - best;
    maxClass = Math.max(maxClass, distinct.length);
    if (examples.length < 6)
      examples.push({ n: members.length, distinctTemplates: distinct.length, ids: members.map((m) => m.id).slice(0, 6) });
  }
}
console.log("admitted:", admitted);
console.log("observable classes:", groups.size);
console.log("classes with >1 distinct template:", collisionClasses);
console.log("min unavoidable non-clean (ceiling loss):", collidingCases, "=> clean ceiling:", admitted - collidingCases);
console.log("max distinct templates in one class:", maxClass);
console.log("examples:", JSON.stringify(examples, null, 1));
