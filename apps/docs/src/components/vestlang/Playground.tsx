import {
  type ReactNode,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import BrowserOnly from "@docusaurus/BrowserOnly";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateStatement } from "@vestlang/evaluator";
import type {
  Program,
  EvaluatedSchedule,
  EvaluationContext,
  OCTDate,
} from "@vestlang/types";
import PlaygroundResults from "./playgroundResults";
import { getVestingEvents, toISODate } from "./helpers";
import { GrantConfiguration } from "./grant-configuration";
import { DSLInput } from "./dsl-input";

export default function Playground(): ReactNode {
  const [quantity, setQuantity] = useState<number>(100);
  const [grantDate, setGrantDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<Record<string, OCTDate | undefined>>({});
  const [dsl, setDsl] = useState<string>(
    "VEST OVER 4 years EVERY 3 months CLIFF 12 months",
  );
  const [ast, setAst] = useState<Program | null>(null);
  const [schedules, setSchedules] = useState<EvaluatedSchedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const todayISO = useMemo(() => toISODate(new Date()), []);

  const run = useCallback(() => {
    try {
      const raw = parse(dsl);
      const normalized = normalizeProgram(raw);
      setAst(normalized);

      // Collect unique event identifiers from AST
      const astEvents = Array.from(new Set(getVestingEvents(normalized)));

      // Build a fresh events object:
      // - Keep only keys that exist in astEvents
      // - Preserve their prior date if present
      // - Add missing keys with todayISO
      const nextEvents: Record<string, OCTDate | undefined> = {};
      for (const k of astEvents) {
        if (k === "grantDate" || k === "vestingStart") continue;
        nextEvents[k] = events[k] ?? undefined;
      }

      // Update state
      setEvents(nextEvents);

      // Merger with grantDate
      const mergedEvents: EvaluationContext["events"] = {
        grantDate: toISODate(grantDate),
        ...nextEvents,
      };

      const ctx: EvaluationContext = {
        events: mergedEvents,
        grantQuantity: quantity,
        asOf: todayISO,
        vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        allocation_type: "CUMULATIVE_ROUND_DOWN",
      };

      const results = normalized.map((s) => evaluateStatement(s, ctx));
      setSchedules(results);
      setError(null);
    } catch (e: any) {
      setAst(null);
      setSchedules(null);
      setError(e?.message ?? String(e));
    }
  }, [dsl, quantity, grantDate, events, todayISO]);

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

                  {schedules && ast && (
                    <PlaygroundResults schedules={schedules} ast={ast} />
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
