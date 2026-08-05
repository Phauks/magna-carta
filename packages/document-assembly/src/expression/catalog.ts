// The helper allowlist. A FROZEN table built from a literal array and looked up through a Map — a
// template-supplied name is never used to index a JavaScript object, so there is no lookup that could
// walk a prototype chain and find something we did not write.
//
// This is the structural difference from every general-purpose expression evaluator: theirs is a
// denylist over a language that can already express property traversal and function calls, and a
// denylist over that language has to be right about every escape. Ours is an allowlist over a language
// in which neither has a production. A firm will eventually want something this table does not have,
// and the answer is a row here that we write, review, and test — never a template that computes it.

export type ExpressionType = "text" | "number" | "money" | "rate" | "date" | "boolean" | "list";

// What a parameter accepts.
//  - a concrete type is exactly that type
//  - `scalar` is any type except `list`, because a list is not a first-class value: it can be neither
//    constructed, indexed, assigned, nor passed anywhere but `count`, `isEmpty`, and a repeating block
//  - `integer` is a `number` whose value must be exact and whole; the wholeness is checked at
//    evaluation because a count can arrive from a merge field as well as from a literal
//  - `mergeKey` accepts only a NAME written out in the expression, never a computed value — `has` asks
//    whether a specific field resolved, which is a question about a name rather than about a value
//  - `sameAsFirst` / `sameAsSecond` tie a parameter to an earlier one, which is how `default` and
//    `choose` stay total without becoming generic
export type ParameterSpecification =
  | ExpressionType
  | "scalar"
  | "integer"
  | "mergeKey"
  | "sameAsFirst"
  | "sameAsSecond";

export type ResultSpecification = ExpressionType | "sameAsFirst" | "sameAsSecond";

export interface HelperSignature {
  readonly name: string;
  readonly parameters: readonly ParameterSpecification[];
  // Present on the one variadic helper: any number of further arguments of this type. Its cost is
  // bounded by the call-node and text-result caps rather than by the signature.
  readonly variadic?: ParameterSpecification;
  readonly result: ResultSpecification;
  // What the field inspector shows an author. Consumer-facing text: it states what the helper does, in
  // the words someone writing a template would use.
  readonly summary: string;
}

const HELPER_LIST: readonly HelperSignature[] = [
  // ------------------------------------------------------------------------------------------
  // Absence — the three total forms
  // ------------------------------------------------------------------------------------------
  {
    name: "has",
    parameters: ["mergeKey"],
    result: "boolean",
    summary: "Whether the matter supplies a value for that field. Always answers yes or no.",
  },
  {
    name: "default",
    parameters: ["scalar", "sameAsFirst"],
    result: "sameAsFirst",
    summary: "The first value, or the second one when the first has no value on this matter.",
  },
  {
    name: "choose",
    parameters: ["boolean", "scalar", "sameAsSecond"],
    result: "sameAsSecond",
    summary:
      "The second value when the condition holds, otherwise the third. The arm not taken is never worked out.",
  },

  // ------------------------------------------------------------------------------------------
  // Text
  // ------------------------------------------------------------------------------------------
  {
    name: "concat",
    parameters: ["text"],
    variadic: "text",
    result: "text",
    summary: "Several pieces of text joined end to end.",
  },
  { name: "upper", parameters: ["text"], result: "text", summary: "The text in capitals." },
  { name: "lower", parameters: ["text"], result: "text", summary: "The text in lower case." },
  {
    name: "titleCase",
    parameters: ["text"],
    result: "text",
    summary: "The text with each word capitalised, leaving names already in mixed case alone.",
  },

  // ------------------------------------------------------------------------------------------
  // Money — where division lives, because an infix / states nothing about rounding
  // ------------------------------------------------------------------------------------------
  {
    name: "divideExact",
    parameters: ["money", "integer"],
    result: "money",
    summary: "The amount split evenly, refusing when it does not come out even to the cent.",
  },
  {
    name: "divideRounded",
    parameters: ["money", "integer"],
    result: "money",
    summary:
      "The amount split evenly, rounded to the nearest cent (a half-cent goes to the even one). What is left over is gone.",
  },
  {
    name: "allocate",
    parameters: ["money", "integer"],
    result: "list",
    summary:
      "The amount split into that many parts which add back up to it exactly. Only a repeating block can walk the parts.",
  },
  {
    name: "applyRate",
    parameters: ["money", "rate"],
    result: "money",
    summary: "The amount at the given rate, rounded to the nearest cent.",
  },
  {
    name: "percentOf",
    parameters: ["money", "number"],
    result: "money",
    summary:
      "The amount times a decimal fraction — 0.075 is seven and a half percent — rounded to the nearest cent.",
  },

  // ------------------------------------------------------------------------------------------
  // Dates — calendar dates in the matter's office's time zone, never instants
  // ------------------------------------------------------------------------------------------
  {
    name: "addDays",
    parameters: ["date", "integer"],
    result: "date",
    summary: "The date that many days later. A negative number goes back.",
  },
  {
    name: "addMonths",
    parameters: ["date", "integer"],
    result: "date",
    summary:
      "The date that many months later. The 31st of January plus one month is the last day of February.",
  },
  {
    name: "addYears",
    parameters: ["date", "integer"],
    result: "date",
    summary:
      "The date that many years later. The 29th of February in a leap year becomes the 28th.",
  },
  {
    name: "daysBetween",
    parameters: ["date", "date"],
    result: "number",
    summary:
      "How many days from the first date to the second. Negative when the second is earlier.",
  },
  { name: "year", parameters: ["date"], result: "number", summary: "The date's year." },
  { name: "month", parameters: ["date"], result: "number", summary: "The date's month, 1 to 12." },
  { name: "day", parameters: ["date"], result: "number", summary: "The date's day of the month." },
  {
    name: "monthName",
    parameters: ["date"],
    result: "text",
    summary: "The name of the date's month.",
  },

  // ------------------------------------------------------------------------------------------
  // Lists — the only two things that may be asked of one outside a repeating block
  // ------------------------------------------------------------------------------------------
  {
    name: "count",
    parameters: ["list"],
    result: "number",
    summary: "How many items the list has.",
  },
  {
    name: "isEmpty",
    parameters: ["list"],
    result: "boolean",
    summary: "Whether the list has no items at all.",
  },
];

const BY_NAME: ReadonlyMap<string, HelperSignature> = new Map(
  HELPER_LIST.map((helper) => [helper.name, Object.freeze(helper)]),
);

export const HELPER_CATALOG: readonly HelperSignature[] = Object.freeze([...HELPER_LIST]);

// The only way a name becomes something callable. A Map lookup, not a property read.
export function lookupHelper(name: string): HelperSignature | undefined {
  return BY_NAME.get(name);
}

export function helperNames(): readonly string[] {
  return HELPER_CATALOG.map((helper) => helper.name);
}

// The arity a signature admits. Stated once so the parser's message and the checker's agree.
export function helperArity(helper: HelperSignature): {
  readonly minimum: number;
  readonly maximum: number;
} {
  return {
    minimum: helper.parameters.length,
    maximum: helper.variadic === undefined ? helper.parameters.length : Number.MAX_SAFE_INTEGER,
  };
}
