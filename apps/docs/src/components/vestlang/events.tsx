import { OCTDate } from "@vestlang/types";
import { Dispatch, SetStateAction } from "react";

export default function Events({
  events,
  eventName,
  setEventName,
  eventDate,
  setEventDate,
  setEvents,
}: {
  events: Record<string, OCTDate>;
  eventName: string;
  setEventName: Dispatch<SetStateAction<string>>;
  eventDate: OCTDate;
  setEventDate: Dispatch<SetStateAction<OCTDate>>;
  setEvents: Dispatch<SetStateAction<Record<string, OCTDate>>>;
}) {
  const onAddEvent = () => {
    const name = eventName.trim();
    const date = eventDate as OCTDate;
    if (!name) return;
    setEvents((prev: Record<string, OCTDate>) => ({ ...prev, [name]: date }));
    setEventName("");
  };

  const onRemoveEvent = (name: string) => {
    setEvents((prev: Record<string, OCTDate>) => {
      const { [name]: _, ...rest } = prev;
      return rest;
    });
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 600 }}>Events (name - YYYY-MM-DD)</div>

      <div
        style={{
          display: "grid",
          gap: 8,
          gridTemplateColumns: "1fr 180px 120px",
        }}
      >
        <input
          type="text"
          placeholder="e.g., milestone"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          style={{ padding: 8 }}
        />
        <input
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          style={{ padding: 8 }}
        />
        <button
          onClick={onAddEvent}
          disabled={!eventName.trim()}
          style={{ padding: 8 }}
        >
          Add event
        </button>
      </div>

      {Object.keys(events).length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  padding: 8,
                  borderBottom: "1px solid var(--ifm-toc-border-color)",
                }}
              >
                Name
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: 8,
                  borderBottom: "1px solid var(--ifm-toc-border-color)",
                }}
              >
                Date (YYYY-MM-DD)
              </th>
              <th
                style={{
                  width: 80,
                  borderBottom: "1px solid var(--ifm-toc-border-color)",
                }}
              />
            </tr>
          </thead>
          <tbody>
            {Object.entries(events).map(
              ([name, date]: [string, OCTDate], index) => (
                <tr key={`${name}-${index}`}>
                  <td
                    style={{
                      padding: 8,
                      borderBottom: "1px solid var(--ifm-toc-border-color)",
                    }}
                  >
                    {name}
                  </td>
                  <td
                    style={{
                      padding: 8,
                      borderBottom: "1px solid var(--ifm-toc-border-color)",
                    }}
                  >
                    {date}
                  </td>
                  <td
                    style={{
                      padding: 8,
                      textAlign: "right",
                      borderBottom: "1px solid var(--ifm-toc-border-color)",
                    }}
                  >
                    <button onClick={() => onRemoveEvent(name)}>Remove</button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      ) : (
        <div style={{ opacity: 0.7 }}>No custom events added yet.</div>
      )}
    </div>
  );
}
