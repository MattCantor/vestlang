import { EvaluatedSchedule } from "@vestlang/types";
import { InstallmentsTable } from "./installmentsTable";

export function Schedule({ schedules }: { schedules: EvaluatedSchedule[] }) {
  return (
    <>
      <h3 style={{ marginBottom: 4 }}>Installments</h3>
      {schedules.map((s: EvaluatedSchedule, index: number) => (
        <>
          <InstallmentsTable key={index} installments={s.installments} />
          {s.blockers.length > 0 ? JSON.stringify(s.blockers) : null}
        </>
      ))}
    </>
  );
}
