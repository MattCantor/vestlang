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
  Installment,
  OCTDate,
} from "@vestlang/types";
import { InstallmentsTable } from "./installmentsTable";

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
  const [schedule, setSchedule] = useState<
    EvaluatedSchedule<Installment>[] | null
  >(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // local inputs for adding an event row
  const [eventName, setEventName] = useState<string>("");
  const [eventDate, setEventDate] = useState<string>(toISODate(new Date())); // YYYY-MM-DD

  const todayISO = useMemo(() => toISODate(new Date()), []);

  const run = useCallback(() => {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  }, [dsl, quantity, grantDate, events, todayISO]);

  // Auto-run with light debounce on any relevant change
  useEffect(() => {
    const t = window.setTimeout(run, 250);
    return () => window.clearTimeout(t);
  }, [run, dsl, quantity, grantDate, events]);

  const onAddEvent = () => {
    const name = eventName.trim();
    const date = eventDate as OCTDate;
    if (!name) return;
    setEvents((prev) => ({ ...prev, [name]: date }));
    setEventName("");
  };

  const onRemoveEvent = (name: string) => {
    setEvents((prev) => {
      const { [name]: _, ...rest } = prev;
      return rest;
    });
  };

  return (
    <BrowserOnly>
      {() => (
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ fontWeight: 600 }}>Try a vestlang statement</label>
          <textarea
            value={dsl}
            onChange={(e) => setDsl(e.target.value)}
            rows={3}
          />
          {/* --- Inputs row --- */}
          <div
            style={{
              display: "grid",
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
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Events (name - YYYY-MM-DD)</div>

            <div
              style={{
                display: "grid",
                gap: 8,
                gridTemplateColumns: "1fr 180px 120px",
              }}
            >
              <input
                type="text"
                placeholder="e.g., milestone"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                style={{ padding: 8 }}
              />
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                style={{ padding: 8 }}
              />
              <button
                onClick={onAddEvent}
                disabled={!eventName.trim()}
                style={{ padding: 8 }}
              >
                Add event
              </button>
            </div>

            {Object.keys(events).length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: "1px solid var(--ifm-toc-border-color)",
                      }}
                    >
                      Name
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: "1px solid var(--ifm-toc-border-color)",
                      }}
                    >
                      Date (YYYY-MM-DD)
                    </th>
                    <th
                      style={{
                        width: 80,
                        borderBottom: "1px solid var(--ifm-toc-border-color)",
                      }}
                    />
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(events).map(([name, date], index) => (
                    <tr key={`${name}-${index}`}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: "1px solid var(--ifm-toc-border-color)",
                        }}
                      >
                        {name}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: "1px solid var(--ifm-toc-border-color)",
                        }}
                      >
                        {date}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          textAlign: "right",
                          borderBottom: "1px solid var(--ifm-toc-border-color)",
                        }}
                      >
                        <button onClick={() => onRemoveEvent(name)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ opacity: 0.7 }}>No custom events added yet.</div>
            )}
          </div>

          {error && (
            <div>
              <strong>Error:</strong>
              {error}
            </div>
          )}
          {ast && (
            <>
              <h3 style={{ marginBottom: 4 }}>AST</h3>
              <pre
                style={{
                  background: "var(--ifm-pre-background)",
                  padding: 12,
                  overflow: "auto",
                }}
              >
                {JSON.stringify(ast, null, 2)}
              </pre>
            </>
          )}
          {schedule && (
            <>
              <h3 style={{ marginBottom: 4 }}>Installments</h3>
              {schedule.map((s, index) => (
                <InstallmentsTable key={index} installments={s.installments} />
              ))}
            </>
          )}
        </div>
      )}
    </BrowserOnly>
  );
}
