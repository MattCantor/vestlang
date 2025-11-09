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
  const [events, setEvents] = useState<Record<string, OCTDate>>({});
  const [dsl, setDsl] = useState<string>("");
  const [ast, setAst] = useState<Program | null>(null);
  const [schedules, setSchedules] = useState<EvaluatedSchedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // local inputs for adding an event row
  // const [eventName, setEventName] = useState<string>("");
  // const [eventDate, setEventDate] = useState<OCTDate>(toISODate(new Date())); // YYYY-MM-DD

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
      const nextEvents: Record<string, OCTDate> = {};
      for (const k of astEvents) {
        if (k === "grantDate") continue;
        nextEvents[k] = events[k] ?? todayISO;
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
        <div className="min-h-screen flex justify-center bg-gradient-to-br from-background to-muted/20 p-4">
          <Card className="w-full max-w-2xl shadow-xl">
            <CardHeader className="border-b bg-card">
              <CardTitle className="text-2xl font-semibold">
                Vestlang Playground
              </CardTitle>
              <CardDescription>
                Enter grant details and DSL statement
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6 mb-8">
                <div className="flex flex-col gap-4 max-w-lg mx-auto">
                  {/* Quantity */}
                  <div className="space-y-2">
                    <Label htmlFor="quantity" className="text-sm font-medium">
                      Quantity
                    </Label>
                    <Input
                      id="quantity"
                      type="number"
                      min={0}
                      value={Number.isFinite(quantity) ? quantity : 100}
                      onChange={(e) =>
                        setQuantity(Number(e.target.value) || 100)
                      }
                      className="w-full"
                    />
                  </div>

                  {/* Grant Date */}
                  <div className="space-y-2">
                    <Label htmlFor="grantDate" className="text-sm font-medium">
                      Grant Date
                    </Label>
                    <Input
                      id="grantDate"
                      type="date"
                      value={toISODate(grantDate)}
                      onChange={(e) => setGrantDate(new Date(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  {/* --- Events editor --- */}
                  <Events events={events} setEvents={setEvents} />

                  {/* --- DSL input --- */}
                  <div className="space-y-2">
                    <Label htmlFor="dsl" className="text-sm font-medium">
                      DSL Input
                    </Label>
                    <Textarea
                      id="dsl"
                      value={dsl}
                      onChange={(e) => setDsl(e.target.value)}
                      rows={3}
                      className="w-full"
                    />
                  </div>

                  {/* --- DSL Error --- */}
                  {error && dsl !== "" && (
                    <div>
                      <strong>Error:</strong>
                      {error}
                    </div>
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
