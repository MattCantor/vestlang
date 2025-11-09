import { EvaluatedSchedule } from "@vestlang/types";

export function InstallmentsTable({
  installments,
}: {
  installments: EvaluatedSchedule["installments"];
}) {
  return (
    <div className="overflow-auto max-h-[60vh] rounded-md">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[color:var(--card-border)]">
            <th className="text-left font-semibold py-2 pr-3">Amount</th>
            <th className="text-left font-semibold py-2">Date</th>
          </tr>
        </thead>
        <tbody>
          {installments.map((installment, index) => (
            <tr
              key={index}
              className="border-b border-[color:var(--card-border)] hover:bg-black/5 dark:hover:bg-white/5"
            >
              <td className="py-2 pr-3">{installment.amount}</td>
              <td className="py-2 pr-3">
                {installment.meta.state === "RESOLVED"
                  ? installment.date
                  : JSON.stringify(installment.meta.symbolicDate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
