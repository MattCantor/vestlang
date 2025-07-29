export {}; // required

declare module "./parser.js" {
  export interface VestingSchedule {
    type: "Schedule";
    name: string;
    items: Array<{
      type: "Cliff";
      duration: number;
      percent: number;
    }>;
  }

  export function parse(input: string): VestingSchedule;
}