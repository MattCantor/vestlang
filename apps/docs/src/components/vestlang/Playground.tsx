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
import Events from "./events";
import PlaygroundResults from "./playgroundResults";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { toISODate } from "./helpers";

export default function Playground(): ReactNode {
  const [quantity, setQuantity] = useState<number>(100);
  const [grantDate, setGrantDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<Record<string, OCTDate | undefined>>({});
  const [dsl, setDsl] = useState<string>("");
  const [ast, setAst] = useState<Program | null>(null);
  const [schedules, setSchedules] = useState<EvaluatedSchedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const todayISO = useMemo(() => toISODate(new Date()), []);

  const getVestingEvents = (ast: Program): string[] => {
    const vestingEvents: string[] = [];
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
        return;
      }
      if (node && typeof node === "object") {
        const rec = node as Record<string, unknown>;
        if (rec.type === "EVENT" && typeof rec.value === "string") {
          vestingEvents.push(rec.value);
        }
        for (const v of Object.values(rec)) visit(v);
      }
    };
    visit(ast);
    return vestingEvents;
  };

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
        <div className="ui-minh-screen ui-flex ui-center ui-bg-grad ui-p-4">
          <Card className="ui-w-full ui-maxw-2xl ui-shadow-xl">
            <CardHeader className="ui-border-b ui-bg-card">
              <CardTitle className="ui-text-2xl ui-font-semibold">
                Vestlang Playground
              </CardTitle>
              <CardDescription>
                Enter grant details and DSL statement
              </CardDescription>
            </CardHeader>
            <CardContent className="ui-pt-6">
              <div className="ui-spacey-6 ui-mb-8">
                <div className="ui-col ui-gap-4 ui-maxw-lg ui-mx-auto">
                  {/* Quantity */}
                  <div className="ui-spacey-2">
                    <Label htmlFor="quantity">Quantity</Label>
                    <Input
                      id="quantity"
                      type="number"
                      min={0}
                      value={Number.isFinite(quantity) ? quantity : 100}
                      onChange={(e) =>
                        setQuantity(Number(e.target.value) || 100)
                      }
                      className="ui-w-full"
                    />
                  </div>

                  {/* Grant Date */}
                  <div className="ui-spacey-2">
                    <Label htmlFor="grantDate">Grant Date</Label>
                    <Input
                      id="grantDate"
                      type="date"
                      value={toISODate(grantDate)}
                      onChange={(e) => setGrantDate(new Date(e.target.value))}
                      className="ui-w-full"
                    />
                  </div>

                  {/* --- Events editor --- */}
                  <Events events={events} setEvents={setEvents} />

                  {/* --- DSL input --- */}
                  <div className="ui-spacey-2">
                    <Label htmlFor="dsl">DSL Input</Label>
                    <Textarea
                      id="dsl"
                      value={dsl}
                      onChange={(e) => setDsl(e.target.value)}
                      rows={5}
                      className="ui-w-full"
                    />
                  </div>

                  {/* --- DSL Error --- */}
                  {error && dsl !== "" && (
                    <pre
                      style={{
                        color: "var(--ifm-color-danger-dark)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {error}
                    </pre>
                  )}
                </div>
              </div>
              {/* --- Results --- */}
              {schedules && ast && (
                <PlaygroundResults schedules={schedules} ast={ast} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </BrowserOnly>
  );
}
