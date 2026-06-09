import { type ReactNode, useState, useCallback, useEffect } from "react";
import BrowserOnly from "@docusaurus/BrowserOnly";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import {
  runEvaluate,
  type GrantInput,
  type ScheduleView,
  type RecoveredView,
  type ClauseBreakdown,
} from "@vestlang/pipeline";
import type { Program, OCTDate } from "@vestlang/types";
import PlaygroundResults from "./playgroundResults";
import { getVestingEvents, toISODate } from "./helpers";
import { GrantConfiguration } from "./grant-configuration";
import { DSLInput } from "./dsl-input";

// The whole program collapsed into one schedule (`view`), plus what each clause
// contributed (`breakdown`) and, if an events-only program was recovered back to
// a template, the recovery note. Mirrors what the MCP/CLI evaluate returns.
type ProgramResult = {
  view: ScheduleView;
  recovered?: RecoveredView;
  breakdown: ClauseBreakdown[];
};

export default function Playground(): ReactNode {
  const [quantity, setQuantity] = useState<number>(100);
  const [grantDate, setGrantDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<Record<string, OCTDate | undefined>>({});
  const [dsl, setDsl] = useState<string>(
    "VEST OVER 4 years EVERY 3 months CLIFF 12 months",
  );
  const [ast, setAst] = useState<Program | null>(null);
  const [result, setResult] = useState<ProgramResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    let normalized: Program;
    try {
      normalized = normalizeProgram(parse(dsl));
    } catch (e: any) {
      setAst(null);
      setResult(null);
      setError(e?.message ?? String(e));
      return;
    }
    setAst(normalized);

    // Sync the event-date inputs to whatever events the statement names: keep a
    // box for each one (carrying over any date already entered), drop the rest.
    // grantDate / vestingStart are anchors, not user-supplied events.
    const namedEvents: Record<string, OCTDate | undefined> = {};
    for (const k of new Set(getVestingEvents(normalized))) {
      if (k === "grantDate" || k === "vestingStart") continue;
      namedEvents[k] = events[k] ?? undefined;
    }
    setEvents(namedEvents);

    // The pipeline owns the rest — parse, context (it injects the grant-date
    // anchor itself, so we pass only genuine named events with a date), collapse,
    // recovery — and hands back one program-scoped view plus the per-clause
    // breakdown. Events still awaiting a date are simply left out (unfired).
    const grant: GrantInput = {
      grant_date: toISODate(grantDate),
      grant_quantity: quantity,
      events: Object.fromEntries(
        Object.entries(namedEvents).filter(([, v]) => v !== undefined),
      ) as Record<string, OCTDate>,
      vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    };

    const evaluated = runEvaluate(dsl, grant);
    if ("error" in evaluated) {
      setResult(null);
      setError(evaluated.error.message);
      return;
    }
    setResult({
      view: evaluated.view,
      recovered: evaluated.recovered,
      breakdown: evaluated.breakdown,
    });
    setError(null);
  }, [dsl, quantity, grantDate, events]);

  // Auto-run with light debounce on any relevant change
  useEffect(() => {
    const t = window.setTimeout(run, 250);
    return () => window.clearTimeout(t);
  }, [run, dsl, quantity, grantDate, events]);

  return (
    <BrowserOnly>
      {() => (
        <div
          className="padding--md"
          style={{
            background: "var(--ifm-background-surface-color)",
          }}
        >
          <div style={{ maxWidth: "auto", margin: "0 auto" }}>
            <div className="card shadow--md">
              <div
                className="card__header"
                style={{
                  background: "var(--ifm-color-emphasis-200)",
                  borderBottom: "1px solid var(--ifm-color-emphasis-300)",
                }}
              >
                <h1
                  style={{
                    marginBottom: "0.5rem",
                    color: "var(--ifm-font-color-base)",
                  }}
                >
                  Vestlang Playground
                </h1>
                <p
                  style={{
                    color: "var(--ifm-color-emphasis-700)",
                    marginBottom: "1rem",
                  }}
                >
                  Configure your vesting schedule and see results in real-time
                </p>
              </div>
              <div className="card__body">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: "2rem",
                  }}
                >
                  <GrantConfiguration
                    quantity={quantity}
                    setQuantity={setQuantity}
                    grantDate={grantDate}
                    setGrantDate={setGrantDate}
                    events={events}
                    setEvents={setEvents}
                  />

                  {/* DSL Input */}
                  <DSLInput dsl={dsl} setDsl={setDsl} error={error} />

                  {/* Results */}

                  {result && ast && (
                    <PlaygroundResults
                      view={result.view}
                      recovered={result.recovered}
                      breakdown={result.breakdown}
                      ast={ast}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </BrowserOnly>
  );
}
