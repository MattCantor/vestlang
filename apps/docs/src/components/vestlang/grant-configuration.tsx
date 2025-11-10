import { Dispatch, SetStateAction } from "react";
import { toISODate } from "./helpers";
import { OCTDate } from "@vestlang/types";
import Events from "./events";

export function GrantConfiguration({
  quantity,
  setQuantity,
  grantDate,
  setGrantDate,
  events,
  setEvents,
}: {
  quantity: number;
  setQuantity: Dispatch<SetStateAction<number>>;
  grantDate: Date;
  setGrantDate: Dispatch<SetStateAction<Date>>;
  events: Record<string, OCTDate>;
  setEvents: Dispatch<SetStateAction<Record<string, OCTDate>>>;
}) {
  return (
    <div className="card">
      <div className="card__header">
        <h3 style={{ marginBottom: 0 }}>Grant Configuration</h3>
      </div>
      <div className="card__body">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "1.5rem",
            marginBottom: "1.5rem",
          }}
        >
          {/* Quantity */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <label
              htmlFor="quantity"
              style={{
                fontWeight: "600",
                color: "var(--ifm-font-color-base)",
                fontSize: "0.875rem",
                display: "block",
                marginBottom: "0.5rem",
              }}
            >
              Quantity
            </label>
            <input
              id="quantity"
              type="number"
              min={0}
              value={Number.isFinite(quantity) ? quantity : 100}
              onChange={(e) => setQuantity(Number(e.target.value) || 100)}
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
          </div>

          {/* Grant Date */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <label
              htmlFor="grantDate"
              style={{
                fontWeight: "600",
                color: "var(--ifm-font-color-base)",
                fontSize: "0.875rem",
                display: "block",
                marginBottom: "0.5rem",
              }}
            >
              Grant Date
            </label>
            <input
              id="grantDate"
              type="date"
              value={toISODate(grantDate)}
              onChange={(e) => setGrantDate(new Date(e.target.value))}
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
          </div>
        </div>
        {/* Events Section */}
        <Events events={events} setEvents={setEvents} />
      </div>
    </div>
  );
}
