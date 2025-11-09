import { OCTDate } from "@vestlang/types";
import { Dispatch, SetStateAction } from "react";
import { Label } from "../ui/label";
import { Input } from "../ui/input";

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
    <div className="space-y-3">
      {Object.keys(events).length > 0 ? (
        <>
          <Label className="text-sm font-medium">Events</Label>
          <div className="overlow-x-auto">
            <table className="w-auto min-w-max border-collapse text-sm">
              <thead>
                <tr className="border-b border-[color:var(--ifm-toc-border-color)]">
                  <th className="text-left font-semibold py-2 pr-3">Name</th>
                  <th className="text-left font-semibold py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(events).map(
                  ([name, date]: [string, OCTDate], index) => (
                    <tr
                      key={`${name}-${index}`}
                      className="border-b border-[color:var(--ifm-toc-border-color)] hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">{name}</td>
                      <td className="py-2 pr-3">
                        <Input
                          type="date"
                          value={date}
                          onChange={(e) =>
                            onChangeEvent(name, e.target.value as OCTDate)
                          }
                          className="min-w-[10rem]"
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
