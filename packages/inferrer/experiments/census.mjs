// Collision census over the oracle grid: how many admitted cases share an
// identical observable (aggregated projection + grantDate) with a DIFFERENT
// original template? That count is the information-theoretic clean ceiling for
// ANY inferrer (analytic or search).
const W = "/home/avitham/code/vestlang/.claude/worktrees/inferrer-fwd-base";
const { parse } = await import(W + "/packages/dsl/dist/index.js");
const { normalizeProgram } = await import(W + "/packages/normalizer/dist/index.js");
const { evaluateProgram } = await import(W + "/packages/evaluator/dist/index.js");
const { gridCases, SEED_CASES } = await import(
  "file://" + W + "/packages/inferrer/tests/roundtripOracle.gen.ts"
).catch(() => ({ gridCases: null }));

import { isDeepStrictEqual } from "node:util";

// Re-implement the generator inline (gen is TS; avoid tsx import complexity if it failed)
let cases;
if (gridCases) {
  cases = [...gridCases(), ...SEED_CASES];
} else {
  const AXES = {
    offset: ["fromGrant", "backdated"],
    duration: [12, 48],
    cadence: [1, 3, 6, 12],
    cliff: [null, 6, 12],
    total: [96, 100, 1000],
    dom: ["VESTING_START_DAY", "FIRST_DAY_OF_MONTH", "LAST_DAY_OF_MONTH"],
  };
  const START_DATE = "2024-01-01";
  cases = [];
  for (const offset of AXES.offset)
    for (const duration of AXES.duration)
      for (const cadence of AXES.cadence)
        for (const cliff of AXES.cliff)
          for (const total of AXES.total)
            for (const dom of AXES.dom) {
              const from = offset === "backdated" ? `FROM DATE ${START_DATE} ` : "";
              const cl = cliff === null ? "" : ` CLIFF ${cliff} months`;
              cases.push({
                id: `${offset}|${duration}|${cadence}|${cliff}|${total}|${dom}`,
                dsl: `${total} VEST ${from}OVER ${duration} months EVERY ${cadence} months${cl}`,
                grantDate: offset === "backdated" ? "2024-07-01" : START_DATE,
                total, dom,
              });
            }
}

function attempt(c) {
  try {
    const program = normalizeProgram(parse(c.dsl));
    const sched = evaluateProgram(program, {
      grantDate: c.grantDate, events: {}, grantQuantity: c.total,
      vesting_day_of_month: c.dom,
    });
    const r = sched.resolution;
    if (r.status !== "template" || !r.installments.every((i) => i.state === "RESOLVED")) return null;
    const stream = r.installments.map((i) => ({ date: i.date, amount: i.amount }));
    // aggregate
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
for (const [key, members] of groups) {
  // distinct templates within the class
  const distinct = [];
  for (const m of members) {
    if (!distinct.some((d) => isDeepStrictEqual(d.template, m.template))) distinct.push(m);
  }
  if (distinct.length > 1) {
    collisionClasses++;
    // every case whose template is not the (hypothetically chosen) representative is doomed;
    // ceiling loss = members whose template differs from best-represented template
    // count how many members carry each distinct template
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
