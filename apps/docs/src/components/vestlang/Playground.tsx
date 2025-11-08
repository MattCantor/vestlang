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
import AST from "./ast";
import { Schedule } from "./schedule";
import Events from "./events";

function toISODate(d: Date): OCTDate {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10) as OCTDate;
}

export default function Playground(): ReactNode {
  const [quantity, setQuantity] = useState<number>(100);
  const [grantDate, setGrantDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<Record<string, OCTDate>>({});
  const [dsl, setDsl] = useState<string>("");
  const [ast, setAst] = useState<Program | null>(null);
  const [schedule, setSchedule] = useState<EvaluatedSchedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // local inputs for adding an event row
  const [eventName, setEventName] = useState<string>("");
  const [eventDate, setEventDate] = useState<OCTDate>(toISODate(new Date())); // YYYY-MM-DD

  const todayISO = useMemo(() => toISODate(new Date()), []);

  const run = useCallback(() => {
    try {
      const raw = parse(dsl);
      const normalized = normalizeProgram(raw);
      setAst(normalized);

      const mergedEvents: EvaluationContext["events"] = {
        grantDate: toISODate(grantDate),
        ...events,
      };

      const ctx: EvaluationContext = {
        events: mergedEvents,
        grantQuantity: quantity,
        asOf: todayISO,
        vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        allocation_type: "CUMULATIVE_ROUND_DOWN",
      };

      const results = normalized.map((s) => evaluateStatement(s, ctx));
      setSchedule(results);
      setError(null);
    } catch (e: any) {
      setAst(null);
      setSchedule(null);
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
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ fontWeight: 600 }}>Try a vestlang statement</label>

          {/* --- Inputs row --- */}
          <div
            style={{
              display: "flex",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            {/* Quantity */}
            <label style={{ display: "flex", gap: 6 }}>
              <span>Quantity</span>
              <input
                type="number"
                min={0}
                value={Number.isFinite(quantity) ? quantity : 100}
                onChange={(e) => setQuantity(Number(e.target.value) || 100)}
                style={{ padding: 8 }}
              />
            </label>

            {/* Grant Date */}
            <label style={{ display: "flex", gap: 6 }}>
              <span>Grant Date</span>
              <input
                type="date"
                value={toISODate(grantDate)}
                onChange={(e) => setGrantDate(new Date(e.target.value))}
                style={{ padding: 8 }}
              />
            </label>
          </div>

          {/* --- Events editor --- */}
          <Events
            events={events}
            eventName={eventName}
            setEventName={setEventName}
            eventDate={eventDate}
            setEventDate={setEventDate}
            setEvents={setEvents}
          />

          {/* --- DSL input --- */}
          <textarea
            value={dsl}
            onChange={(e) => setDsl(e.target.value)}
            rows={3}
          />

          {/* --- DSL Error --- */}
          {error && (
            <div>
              <strong>Error:</strong>
              {error}
            </div>
          )}

          {/* --- Results --- */}
          {ast && <AST ast={ast} />}
          {schedule && <Schedule schedules={schedule} />}
        </div>
      )}
    </BrowserOnly>
  );
}
