import { OCTDate } from "@vestlang/types";
import { Dispatch, SetStateAction } from "react";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import clsx from "clsx";

export default function Events({
  events,
  setEvents,
}: {
  events: Record<string, OCTDate>;
  setEvents: Dispatch<SetStateAction<Record<string, OCTDate>>>;
}) {
  const onChangeEvent = (name: string, date: OCTDate) => {
    setEvents((prev: Record<string, OCTDate>) => ({
      ...prev,
      [name]: date,
    }));
  };

  return (
    <div className="ui-spacey-3">
      {Object.keys(events).length > 0 ? (
        <>
          <Label>Events</Label>
          <div className="ui-ox-auto">
            <table className={clsx("ui-table", "ui-w-auto", "ui-minw-max")}>
              <thead>
                <tr className="ui-tr--bordered">
                  <th className="ui-th">Name</th>
                  <th className="ui-th">Date</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(events).map(
                  ([name, date]: [string, OCTDate], index) => (
                    <tr
                      key={`${name}-${index}`}
                      className="ui-tr--bordered ui-tr--hover"
                    >
                      <td className="ui-td">{name}</td>
                      <td className="ui-td">
                        <Input
                          type="date"
                          value={date}
                          onChange={(e) =>
                            onChangeEvent(name, e.target.value as OCTDate)
                          }
                          className="ui-minw-10rem"
                        />
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
