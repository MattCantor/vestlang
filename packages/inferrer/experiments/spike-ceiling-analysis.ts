// Ceiling analysis: group admitted cases by byte-identical observable
// (grantDate + aggregated stream); at most ONE distinct template per class can
// ever be clean. Compare the spike's clean set against that ceiling and cluster
// the winnable-but-lost cases by what the preference order chose instead.
import { isDeepStrictEqual } from "node:util";
import {
  CLEAN_TRIPWIRE_CASES,
  gridCases,
  SEED_CASES,
} from "../tests/roundtripOracle.gen.ts";
import { v2Cases } from "./oracleV2.gen.ts";
import { runSweep, type SweepCase, type SweepEntry } from "./sweepRunner.ts";
import { analyticInferrer } from "./analyticSpike.ts";

function analyze(name: string, cases: SweepCase[], split?: (e: SweepEntry) => boolean) {
  const result = runSweep(cases, analyticInferrer);
  const entries = split ? result.entries.filter(split) : result.entries;
  // observable class: grantDate + aggregated projection
  const classes = new Map<string, SweepEntry[]>();
  for (const e of entries) {
    const key = e.grantDate + "|" + JSON.stringify(e.originalAggregated);
    (classes.get(key) ?? classes.set(key, []).get(key)!).push(e);
  }
  let winnable = 0;
  const lost: SweepEntry[] = [];
  for (const [, members] of classes) {
    // distinct templates in the class
    const distinct: SweepEntry[][] = [];
    for (const m of members) {
      const g = distinct.find((d) =>
        isDeepStrictEqual(d[0].originalTemplate, m.originalTemplate),
      );
      if (g) g.push(m);
      else distinct.push([m]);
    }
    winnable += distinct.length > 0 ? Math.max(...distinct.map((d) => d.length)) * 0 + (() => {
      // one template group can be clean; the ceiling counts the LARGEST group's
      // members? No — every member of ONE template group can be clean (same
      // template, same stream -> same recovery). Ceiling adds the size of the
      // biggest template-group.
      return Math.max(...distinct.map((d) => d.length));
    })() : 0;
    // cases the spike could have won but didn't: members of a template group
    // that the spike's recovery matches NO group... find the group the spike's
    // recovered template equals (if any); winnable-but-lost = biggest group when
    // spike picked a different/absent template.
    const clean = members.filter((e) => e.bucket === "clean");
    if (clean.length === 0) {
      const biggest = distinct.reduce((a, b) => (b.length > a.length ? b : a));
      lost.push(...biggest);
    }
  }
  const cleanCount = entries.filter((e) => e.bucket === "clean").length;
  console.log(
    `${name}: admitted ${entries.length}, clean ${cleanCount}, ceiling ${winnable}, winnable-lost ${lost.length}`,
  );
  // cluster the lost winnables
  const clusters = new Map<string, { n: number; ex: string[] }>();
  for (const e of lost) {
    const p = e.params as Record<string, unknown> | null;
    const key = [
      `origDom=${e.originalDom}`,
      `recDom=${e.inferredDom}`,
      `origCliff=${p && "cliff" in p ? p.cliff : "?"}`,
      `recHasCliff=${/ CLIFF /.test(e.recoveredDsl)}`,
      `off=${p && "offset" in p ? p.offset : "?"}`,
    ].join("|");
    const cur = clusters.get(key) ?? { n: 0, ex: [] };
    cur.n++;
    if (cur.ex.length < 2) cur.ex.push(`${e.originalDsl}  ->  ${e.recoveredDsl}`);
    clusters.set(key, cur);
  }
  for (const [k, v] of [...clusters.entries()].sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${v.n}  ${k}\n      ${v.ex.join("\n      ")}`);
}

const v1 = [...gridCases(), ...SEED_CASES, ...CLEAN_TRIPWIRE_CASES];
analyze("v1", v1);
const v2 = v2Cases();
const byId = new Map(v2.map((c) => [c.id, c]));
analyze("widened-main", v2, (e) => byId.get(e.id)!.params.dom !== "VESTING_START_DAY_MINUS_ONE");
analyze("widened-minusOne", v2, (e) => byId.get(e.id)!.params.dom === "VESTING_START_DAY_MINUS_ONE");
