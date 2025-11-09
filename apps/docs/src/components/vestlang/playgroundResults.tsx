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
      <TabsContent value="Installments" className="mt-4">
        {schedules.map((s: EvaluatedSchedule, index: number) => (
          <>
            <InstallmentsTable key={index} installments={s.installments} />
            {s.blockers.length > 0 ? JSON.stringify(s.blockers) : null}
          </>
        ))}
      </TabsContent>
      <TabsContent value="AST">
        <pre className="text-xs leading-relaxed overflow-auto max-h-[60vh] rounded-md p-3 bg-[color:var(--ifm-pre-background)]">
          {JSON.stringify(ast, null, 2)}
        </pre>
      </TabsContent>
    </Tabs>
  );
}
