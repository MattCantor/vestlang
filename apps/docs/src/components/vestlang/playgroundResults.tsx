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
    <Tabs defaultValue="Installments">
      <TabsList>
        <TabsTrigger value="Installments">Installments</TabsTrigger>
        <TabsTrigger value="AST">AST</TabsTrigger>
      </TabsList>
      <TabsContent value="Installments" className="ui-mt-4">
        {schedules.map((s: EvaluatedSchedule, index: number) => (
          <>
            <InstallmentsTable key={index} installments={s.installments} />
            {s.blockers.length > 0 ? JSON.stringify(s.blockers) : null}
          </>
        ))}
      </TabsContent>
      <TabsContent value="AST">
        <pre
          style={{
            fontSize: "0.75rem",
            lineHeight: 1.5,
            overflow: "auto",
            maxHeight: "60vh",
            borderRadius: "var(--ui-radius)",
            padding: "0.75rem",
            background: "var(--ifm-pre-background)",
          }}
        >
          {JSON.stringify(ast, null, 2)}
        </pre>
      </TabsContent>
    </Tabs>
  );
}
