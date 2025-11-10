import { OCTDate } from "@vestlang/types";
import { Dispatch, SetStateAction } from "react";

export default function Events({
  events,
  setEvents,
}: {
  events: Record<string, OCTDate | undefined>;
  setEvents: Dispatch<SetStateAction<Record<string, OCTDate | undefined>>>;
}) {
  const onChangeEvent = (name: string, date: OCTDate) => {
    setEvents((prev: Record<string, OCTDate>) => ({
      ...prev,
      [name]: date,
    }));
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      <label
        htmlFor="events"
        style={{
          fontWeight: "600",
          color: "var(--ifm-font-color-base)",
          fontSize: "0.875rem",
          display: "block",
          marginBottom: "0.5rem",
        }}
      >
        Events
      </label>
      {Object.keys(events).length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table
            className="table-bordered"
            style={{ width: `100%`, background: "var(--ifm-color-base)" }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.75rem 1rem" }}>
                  Name
                </th>
                <th style={{ textAlign: "left", padding: "0.75rem 1rem" }}>
                  Date
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(events).map(
                ([name, date]: [string, OCTDate], index) => (
                  <tr key={`${name}-${index}`}>
                    <td style={{ padding: "0.75rem 1rem" }}>{name}</td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) =>
                          onChangeEvent(name, e.target.value as OCTDate)
                        }
                        style={{
                          width: "100%",
                          border: "1px solid var(--ifm-color-emphasis-300)",
                          background: "var(--ifm-background-color)",
                          fontSize: "1rem",
                          padding: "0.25rem 0.75rem",
                          borderRadius: "var(--ifm-global-radius)",
                          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
                          color: "var(--ifm-font-color-base)",
                        }}
                      />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          style={{
            padding: "1rem",
            textAlign: "center",
            color: "var(--ifm-color-emphasis-600)",
            fontSize: "0.875rem",
            fontStyle: "italic",
          }}
        >
          No events specified
        </div>
      )}
    </div>
  );
}
