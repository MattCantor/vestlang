import { EvaluatedSchedule } from "@vestlang/types";

export function InstallmentsTable({
  installments,
}: {
  installments: EvaluatedSchedule["installments"];
}) {
  return (
    <div className="ui-scroll">
      <table className="ui-table">
        <thead>
          <tr className="ui-tr--bordered">
            <th className="ui-th">Amount</th>
            <th className="ui-th">Date</th>
          </tr>
        </thead>
        <tbody>
          {installments.map((installment, index) => (
            <tr key={index} className="ui-tr--bordered ui-tr--hover">
              <td className="ui-td">{installment.amount}</td>
              <td className="ui-td">
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
