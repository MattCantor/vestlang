import { Installment } from "@vestlang/types";

export function InstallmentsTable({
  installments,
}: {
  installments: Installment[];
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
                  padding: "0.875rem 1rem",
                  fontWeight: "600",
                }}
              >
                {installment.amount}
              </td>
              <td
                style={{
                  padding: "0.875rem 1rem",
                  fontFamily: "var(--ifm-font-family-monospace)",
                }}
              >
                {installment.state === "RESOLVED"
                  ? installment.date
                  : installment.state === "UNRESOLVED"
                    ? JSON.stringify(installment.symbolicDate)
                    : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
