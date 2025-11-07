import { EvaluatedSchedule, Installment } from "@vestlang/types";

export function InstallmentsTable({
  installments,
}: {
  installments: EvaluatedSchedule<Installment>["installments"];
}) {
  return (
    <div className="installmentsTable__wrapper">
      <table className="installmentsTable">
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
