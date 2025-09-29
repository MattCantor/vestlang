/*****************
 * Existing OCT JSON Schemas
 *****************/
export type NumericType = string;
export type DateType = string;
export type PeriodType = "DAYS" | "MONTHS";
export type VestingPeriod = {
    length: number;
    type: PeriodType;
    occurrences: number;
};
/***************
 * Modified Vesting Period Type
 ***************/
export type ModifiedVestingPeriod = {
    duration: Duration;
};
export type VestingDayOfMonth = [
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
    "10",
    "11",
    "12",
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
    "19",
    "20",
    "21",
    "22",
    "23",
    "24",
    "25",
    "26",
    "27",
    "28",
    "29_OR_LAST_DAY_OF_MONTH",
    "30_OR_LAST_DAY_OF_MONTH",
    "31_OR_LAST_DAY_OF_MONTH",
    "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"
];
export type VestingPeriodInMonths = VestingPeriod & {
    type: "MONTHS";
    day_of_month: VestingDayOfMonth;
};
export type VestingPeriodinDays = VestingPeriod & {
    type: "DAYS";
};
export type VestingConditionPortion = {
    numerator: NumericType;
    denominator: NumericType;
    remainder?: boolean;
};
export type VestingCondition = {
    id: string;
    description: string;
    portion: VestingConditionPortion;
    quantity: NumericType;
};
/***********************
 * New JSON Schemas
 ***********************/
export type Amount = {
    type: "Amount";
    value: number;
};
export type Duration = {
    type: "Duration";
    value: number;
    unit: PeriodType;
};
export type DateAtom = {
    type: "Date";
    iso: DateType;
};
export type EventAtom = {
    type: "Event";
    name: string;
};
export type Cliff = {
    type: "Zero";
} | Duration | DateAtom | EventAtom;
export type ScheduleBlock = {
    from: DateAtom | EventAtom | null;
    over: Duration;
    every: Duration;
    cliff: Cliff;
};
export type Condition = {
    type: "EarlierOf";
    items: Condition[];
} | {
    type: "LaterOf";
    items: Condition[];
} | {
    type: "At";
    item: DateAtom | EventAtom;
} | {
    type: "None";
};
export type Clause = {
    type: "Clause";
    schedule: ScheduleBlock | null;
    if: Condition;
};
export type Expr = Clause | {
    type: "EarlierOfClauses";
    items: Expr[];
} | {
    type: "LaterOfClauses";
    items: Expr[];
};
export type StartNode = {
    amount: Amount;
    expr: Expr;
};
