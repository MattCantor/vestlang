import { ReactNode } from "react";
import { Program } from "@vestlang/types";
import type {
  ScheduleView,
  RecoveredView,
  ClauseBreakdown,
} from "@vestlang/pipeline";
import { InstallmentsTable } from "./installmentsTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

// One labeled block of blockers. The resolution surface splits them into pending
// (still waiting) and dead (contradicted given the firings), so we render each list
// under its own heading.
const blockersBlock = (
  label: string,
  blockers:
    | ScheduleView["pendingBlockers"]
    | ScheduleView["deadBlockers"],
): ReactNode =>
  blockers.length > 0 ? (
    <>
      <p style={{ fontSize: "0.8125rem", margin: "0.5rem 0 0.25rem" }}>
        <strong>{label}</strong>
      </p>
      <pre
        style={{
          fontSize: "0.75rem",
          lineHeight: 1.6,
          overflow: "auto",
          maxHeight: "60vh",
          borderRadius: "var(--ifm-code-border-radius)",
          padding: "0.75rem",
          background: "var(--ifm-code-background)",
        }}
      >
        {JSON.stringify(blockers, null, 2)}
      </pre>
    </>
  ) : null;

export default function PlaygroundResults({
  view,
  recovered,
  breakdown,
  ast,
}: {
  view: ScheduleView;
  recovered?: RecoveredView;
  breakdown: ClauseBreakdown[];
  ast: Program;
}): ReactNode {
  return (
    <div className="card">
      <div className="card__header">
        <h3 style={{ marginBottom: 0 }}>Results</h3>
      </div>
      <div className="card__body">
        <Tabs defaultValue="Installments">
          <TabsList>
            <TabsTrigger value="Installments">Installments</TabsTrigger>
            <TabsTrigger value="AST">AST</TabsTrigger>
          </TabsList>
          <TabsContent value="Installments" className="ui-mt-4">
            {/* The program collapses to one schedule, so there's one of each of
                these — one allocation finding, one verdict pair, one projection.
                The table is shown either way; a finding just flags it (an
                over-allocation error isn't a valid schedule, an under-allocation
                warning is legal but worth noting). */}
            {view.findings.map((f, i) => {
              const tone = f.severity === "error" ? "danger" : "warning";
              return (
                <div
                  key={i}
                  role={f.severity === "error" ? "alert" : "status"}
                  style={{
                    border: `1px solid var(--ifm-color-${tone})`,
                    borderRadius: "var(--ifm-code-border-radius)",
                    padding: "0.5rem 0.75rem",
                    marginBottom: "0.5rem",
                    color: `var(--ifm-color-${tone})`,
                    fontSize: "0.875rem",
                  }}
                >
                  ⚠ {f.message}
                </div>
              );
            })}
            {/* The two verdicts, labeled: what a record keeper could store for
                this grant, and what it resolves to given the events entered. */}
            <p style={{ fontSize: "0.8125rem", marginBottom: "0.5rem" }}>
              <strong>Storable:</strong> {view.interchange.status}
              {"  •  "}
              <strong>Resolves to:</strong> {view.resolution.status}
            </p>
            {/* When an events-only program turned out to have a single-template
                form, the engine recovers it back to a template; this says where
                it came from and shows the inferred DSL. */}
            {recovered ? (
              <p style={{ fontSize: "0.8125rem", marginBottom: "0.5rem" }}>
                <strong>Recovered:</strong> {recovered.from} → template
                {" — "}
                {recovered.reason} <code>{recovered.dsl}</code>
              </p>
            ) : null}
            {/* What the "resolves to" reading is assuming hasn't happened yet —
                events whose later occurrence could change the projection below. */}
            {view.absenceAssumptions.length > 0 ? (
              <p style={{ fontSize: "0.8125rem", marginBottom: "0.5rem" }}>
                <strong>Assumes not yet occurred:</strong>{" "}
                {view.absenceAssumptions.map((a) => a.message).join("; ")}
              </p>
            ) : null}
            <InstallmentsTable installments={view.installments} />
            {blockersBlock("Pending blockers", view.pendingBlockers)}
            {blockersBlock("Dead blockers", view.deadBlockers)}
            {/* Per-clause attribution — which clause produced which tranches.
                Only worth showing when there's more than one clause (a single
                clause just is the program). No verdict here: a clause has no
                storable schedule of its own. */}
            {breakdown.length > 1 ? (
              <div style={{ marginTop: "1rem" }}>
                <p style={{ fontSize: "0.8125rem", marginBottom: "0.5rem" }}>
                  <strong>By clause</strong>
                </p>
                {breakdown.map((clause, i) => (
                  <details key={i} style={{ marginBottom: "0.5rem" }}>
                    <summary style={{ cursor: "pointer" }}>
                      Clause {i + 1}
                    </summary>
                    <div style={{ marginTop: "0.5rem" }}>
                      <InstallmentsTable installments={clause.installments} />
                      {blockersBlock("Pending blockers", clause.pendingBlockers)}
                      {blockersBlock("Dead blockers", clause.deadBlockers)}
                    </div>
                  </details>
                ))}
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value="AST">
            <div
              style={{
                background: "var(--ifm-code-background)",
                borderRadius: "var(--ifm-code-border-radius)",
                padding: "1rem",
              }}
            >
              <pre
                style={{
                  fontSize: "0.75rem",
                  lineHeight: 1.6,
                  overflow: "auto",
                  maxHeight: "60vh",
                  margin: 0,
                }}
              >
                {JSON.stringify(ast, null, 2)}
              </pre>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
