import { EvaluatedSchedule } from "@vestlang/types";

export function InstallmentsTable({
  installments,
}: {
  installments: EvaluatedSchedule["installments"];
}) {
  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Amount</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {installments.map((installment, index) => (
            <tr key={index}>
              <td>{installment.amount}</td>
              <td>
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
