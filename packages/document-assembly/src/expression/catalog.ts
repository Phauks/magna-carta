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
//  - `listField` likewise accepts only a NAME, of the form `<collection>.<field>`, where the collection
//    is a list-valued key and the field is one an item of it carries. An aggregate reads a LITERAL field
//    of an ALREADY-RESOLVED collection and nothing else: its cost is bounded by the data, the same bound
//    a repeating block runs under, and admitting an expression there would make it iteration over
//    computed values, which is the line this language does not cross
//  - `sameAsFirst` / `sameAsSecond` tie a parameter to an earlier one, which is how `default` and
//    `choose` stay total without becoming generic
//  - `personSubject` accepts only the NAME of a subject the document can speak about as a person —
//    `client`, `opposingParty`, `responsibleAttorney`. It is a name rather than a value because a
//    pronoun is a fact about WHOSE it is, and there is no value in the language that carries a
//    person; the checker settles which subjects qualify against the firm's own field catalogue
//  - `pronounForm` accepts only a text LITERAL naming a grammatical position, so a misspelled form
//    is a registration error a template author sees rather than a hole in a filed document
export type ParameterSpecification =
  | ExpressionType
  | "scalar"
  | "integer"
  | "mergeKey"
  | "listField"
  | "personSubject"
  | "pronounForm"
  | "sameAsFirst"
  | "sameAsSecond";

export type ResultSpecification =
  | ExpressionType
  | "sameAsFirst"
  | "sameAsSecond"
  // The type of the FIELD the first argument's path names — the element type of the aggregate, so a
  // total of money is money and a smallest date is a date.
  | "fieldOfFirst";

export interface HelperSignature {
  readonly name: string;
  readonly parameters: readonly ParameterSpecification[];
  // Present on the one variadic helper: any number of further arguments of this type. Its cost is
  // bounded by the call-node and text-result caps rather than by the signature.
  readonly variadic?: ParameterSpecification;
  readonly result: ResultSpecification;
  // Present on a `listField` helper: the element types it admits. A total of text is not a total, and a
  // smallest yes-or-no is not a question anyone asks — so the admissible set is declared per helper and
  // checked at REGISTRATION, where an author is still looking at the template.
  readonly elementTypes?: readonly ExpressionType[];
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
  // Pronouns — the two helpers that let a sentence be about a person without the author knowing
  // which set that person uses
  //
  // These are the only helpers that ANSWER when the firm's record is silent, and that is their whole
  // reason to exist. Every other absence in this subsystem shows a marker, because a hole on a page
  // is safer than a plausible-looking blank; a pronoun is the opposite case, since the sentence is
  // grammatical either way and a marker mid-clause turns an ordinary letter into a document needing
  // repair. So the neutral set answers, and the author never writes the fallback.
  //
  // NEITHER HELPER INFLECTS A VERB. There is no verb dictionary here and there will not be one: a
  // sentence needing "signs" against "sign" needs the two forms an author already knows how to
  // write, and pronounVerb picks between them by the agreement the person's set declares. Guessing
  // an inflection would be the name-guessing failure again, one part of speech over.
  // ------------------------------------------------------------------------------------------
  {
    name: "pronoun",
    parameters: ["personSubject", "pronounForm"],
    result: "text",
    summary:
      'That person\'s pronoun in the position named — "subject", "object", "possessiveDeterminer", "possessivePronoun", or "reflexive". A person whose record states no pronouns is written they, them, their, theirs, themselves.',
  },
  {
    name: "pronounVerb",
    parameters: ["personSubject", "text", "text"],
    result: "text",
    summary:
      'The verb form that agrees with that person\'s pronouns: the second input when they go with "he" or "she" ("signs"), the third when they go with "they" ("sign"). A person whose record states no pronouns takes the "they" form.',
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

  // ------------------------------------------------------------------------------------------
  // Aggregates — one bounded pass over an ALREADY-RESOLVED collection
  //
  // These are the one place a helper's cost grows with the firm's data, and they are bounded by exactly
  // what a repeating block is bounded by: the collection came from one batched read, the item cap
  // applies unchanged, and every element costs a step against the same shared budget. There is still no
  // iteration an author can WRITE — no map, no filter, no comprehension, no expression under the fold.
  // The argument is a literal field path, so the set of values walked is fixed before evaluation starts.
  //
  // `count` is deliberately NOT repeated here. `count(matter.parties)` already answers how many items a
  // collection has; a second spelling over a field path could only differ by skipping items whose field
  // has no value, which is a filter, and a filter is the thing this language refuses.
  //
  // AN AGGREGATE OVER AN EMPTY COLLECTION IS AN ABSENCE, not a zero. A smallest of nothing has no answer
  // in any type; a total of no amounts would have to name a currency, and a currency is a fact the
  // firm's data carries rather than one a template may invent — which is why there is no money literal
  // either. One rule for the whole family, because a rule that changed with the element type is one an
  // author could not predict. The total forms are one word away: isEmpty asks first, default supplies a
  // fallback.
  // ------------------------------------------------------------------------------------------
  {
    name: "sum",
    parameters: ["listField"],
    elementTypes: ["number", "money"],
    result: "fieldOfFirst",
    summary:
      "The total of that field across every item in the list. Amounts must all be in one currency. An empty list, or an item with nothing on file for that field, leaves the total unknown.",
  },
  {
    name: "minimum",
    parameters: ["listField"],
    elementTypes: ["number", "money", "date"],
    result: "fieldOfFirst",
    summary:
      "The smallest value that field takes across the list — the earliest, for dates. An empty list, or an item with nothing on file for that field, leaves it unknown.",
  },
  {
    name: "maximum",
    parameters: ["listField"],
    elementTypes: ["number", "money", "date"],
    result: "fieldOfFirst",
    summary:
      "The largest value that field takes across the list — the latest, for dates. An empty list, or an item with nothing on file for that field, leaves it unknown.",
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
