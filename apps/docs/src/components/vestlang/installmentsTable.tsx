import { EvaluatedSchedule } from "@vestlang/types";

export function InstallmentsTable({
  installments,
}: {
  installments: EvaluatedSchedule["installments"];
}) {
  return (
    <div style={{ overflow: "auto" }}>
      <table
        className="table-bordered"
        style={{ width: "100%", marginBottom: "1rem" }}
      >
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "0.875rem 1rem" }}>
              Amount
            </th>
            <th style={{ textAlign: "left", padding: "0.875rem 1rem" }}>
              Date
            </th>
          </tr>
        </thead>
        <tbody>
          {installments.map((installment, index) => (
            <tr key={index}>
              <td
                style={{
                  padding: "0.875rem 1 rem",
                  fontWeight: "600",
                }}
              >
                {installment.amount}
              </td>
              <td
                style={{
                  padding: "0.875rem 1 rem",
                  fontFamily: "var(--ifm-font-family-monospace)",
                }}
              >
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
