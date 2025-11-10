import { ReactNode } from "react";
import { EvaluatedSchedule, Program } from "@vestlang/types";
import { InstallmentsTable } from "./installmentsTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

export default function PlaygroundResults({
  schedules,
  ast,
}: {
  schedules: EvaluatedSchedule[];
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
            {schedules.map((s: EvaluatedSchedule, index: number) => (
              <>
                <InstallmentsTable key={index} installments={s.installments} />
                {s.blockers.length > 0 ? (
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
                    {JSON.stringify(s.blockers, null, 2)}
                  </pre>
                ) : null}
              </>
            ))}
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
