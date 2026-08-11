// THE REDACTION BOUNDARY, as a grammar rather than as a review note.
//
// A notification row carries identifiers, enum labels, integers, booleans, and dates — and no
// string a person typed. No matter title, no client name, no document filename, no email subject
// line, no deadline description, no custody item description, no location name, no free-text note.
//
// Three reasons, in the order they bind:
//
//   1. The row OUTLIVES THE ACCESS CHECK that justified it. A feed row written today is read next
//      week and swept months later, and access can change in between. A row holding a title holds
//      it after the reader stops being entitled to it, and the only remedies would be deleting
//      rows on every revocation — a sweep that has to be perfect forever — or filtering at read,
//      which works only if the row has nothing to leak.
//   2. A stored title is a STALE title. A deadline renamed, a matter renumbered, or an invoice
//      voided leaves every notification about it wrong, and wrong invisibly, because the row still
//      looks authoritative.
//   3. It costs almost nothing. The feed read already joins `matter` to enforce visibility, so the
//      matter number comes free; the subject itself is resolved when the member follows the deep
//      link, through the owning subsystem's own access-checked read.
//
// So a declared `string` field is a VALIDATION FAILURE and not a warning. That is what makes the
// rule structural: a type that wants to carry a sentence cannot be written, rather than being
// written and caught in review by whoever happens to be reading carefully that day.

// The value kinds a fact may take. `enum` additionally names the labels it may take, so a fact
// field cannot become a free-text field by declaring an open enum.
export type FactValueKind =
  | { readonly kind: "identifier" } // a platform handle, e.g. matterDeadline_…
  | { readonly kind: "integer" } // a count, a day offset, a minor-unit amount
  | { readonly kind: "boolean" }
  | { readonly kind: "enum"; readonly labels: readonly string[] } // labels the TYPE declares
  | { readonly kind: "instant" } // a canonical YYYY-MM-DDTHH:mm:ss.sssZ
  | { readonly kind: "civilDate" }; // YYYY-MM-DD

// A registry type's declared facts shape: field name -> value kind. An empty declaration is
// perfectly normal and means the card renders from the kind and the matter join alone.
export type FactsSchema = Readonly<Record<string, FactValueKind>>;

export type FactValue = string | number | boolean;
export type Facts = Readonly<Record<string, FactValue>>;

// The canonical instant shape the whole platform sorts on. Kept exact rather than lenient: a
// variant precision reorders a text comparison ('.' precedes 'Z' in byte order), which is a class
// of bug no test of the ordering itself would catch.
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
// A platform handle: a registered prefix, an underscore, then the generated body. The grammar does
// not resolve the prefix against the identifier registry — that would make this module depend on
// every producing subsystem's vocabulary — it only insists the value has the SHAPE of a handle,
// which is enough to reject a sentence.
const IDENTIFIER = /^[a-z][a-zA-Z]*_[A-Za-z0-9_-]{1,64}$/;

// The declaration side. Called once per registered type by a fitness test, so a type that declares
// a shape outside the grammar fails at review rather than at a disclosure.
export function validateFactsSchema(schema: FactsSchema): readonly string[] {
  const failures: string[] = [];
  for (const [field, declared] of Object.entries(schema)) {
    if (field.length === 0) {
      failures.push("a facts field name is empty");
      continue;
    }
    switch (declared.kind) {
      case "enum": {
        if (declared.labels.length === 0) {
          failures.push(`${field}: an enum fact declares no labels, which is a free-text field`);
        }
        for (const label of declared.labels) {
          // A label is a LABEL: short, closed, and chosen by the type. The length bound is not
          // cosmetic — an "enum" whose members are sentences is exactly how a description column
          // gets in through a door marked closed-set.
          if (label.length === 0 || label.length > 40) {
            failures.push(`${field}: enum label ${JSON.stringify(label)} is not a short label`);
          }
        }
        break;
      }
      case "identifier":
      case "integer":
      case "boolean":
      case "instant":
      case "civilDate":
        break;
    }
  }
  return failures;
}

// The value side. Called before every insert, so a materializer that computes a value outside its
// own declaration is refused at the write rather than persisted.
export function validateFacts(schema: FactsSchema, facts: Facts): readonly string[] {
  const failures: string[] = [];
  for (const [field, value] of Object.entries(facts)) {
    const declared = schema[field];
    if (declared === undefined) {
      // An undeclared field is refused rather than dropped. Dropping it would let a materializer
      // add a title today and have it silently ignored, which is the state where somebody later
      // "fixes" the drop and ships the disclosure.
      failures.push(`${field}: not declared by the type`);
      continue;
    }
    failures.push(...validateFactValue(field, declared, value));
  }
  for (const field of Object.keys(schema)) {
    if (!(field in facts)) failures.push(`${field}: declared but not supplied`);
  }
  return failures;
}

function validateFactValue(
  field: string,
  declared: FactValueKind,
  value: FactValue,
): readonly string[] {
  switch (declared.kind) {
    case "identifier":
      return typeof value === "string" && IDENTIFIER.test(value)
        ? []
        : [`${field}: not a platform identifier`];
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value)
        ? []
        : [`${field}: not a safe integer`];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${field}: not a boolean`];
    case "enum":
      return typeof value === "string" && declared.labels.includes(value)
        ? []
        : [`${field}: not one of the labels the type declares`];
    case "instant":
      return typeof value === "string" && CANONICAL_INSTANT.test(value)
        ? []
        : [`${field}: not a canonical instant`];
    case "civilDate":
      return typeof value === "string" && CIVIL_DATE.test(value)
        ? []
        : [`${field}: not a civil date`];
  }
}

// Thrown when a materializer produces facts its type did not declare, or values outside the
// grammar. It carries the field-level failures because "the facts are invalid" is not something an
// operator can act on and "matterTitle: not declared by the type" is.
export class FactsValidationError extends Error {
  readonly failures: readonly string[];
  constructor(kind: string, failures: readonly string[]) {
    super(`notification facts refused for ${kind}: ${failures.join("; ")}`);
    this.name = "FactsValidationError";
    this.failures = failures;
  }
}

export function assertFacts(kind: string, schema: FactsSchema, facts: Facts): Facts {
  const failures = validateFacts(schema, facts);
  if (failures.length > 0) throw new FactsValidationError(kind, failures);
  return facts;
}
