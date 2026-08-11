import {
  helperArity,
  type ExpressionType,
  type HelperSignature,
  type ParameterSpecification,
} from "./catalog.ts";
import { expressionSucceeded, type ExpressionFailure, type ExpressionOutcome } from "./errors.ts";
import { splitListFieldPath } from "./lex.ts";
import { EXPRESSION_LIMITS } from "./limits.ts";
import { isPronounForm, PRONOUN_FORMS } from "./pronoun.ts";
import { parse, type ExpressionNode } from "./parse.ts";

// Name resolution and static typing — the stage that turns "this parses" into "this means something,
// and we know what type it means".
//
// A TYPE ERROR IS A REGISTRATION ERROR WITH A LOCATION, NEVER AN ASSEMBLY SURPRISE. That is the whole
// reason this stage exists, and it is the same trade the normalization pass already made for run
// splitting: the fiddly, failure-prone work happens once, at the moment a human is looking at the
// result, rather than at 4:55pm on a filing deadline.
//
// Names resolve through Map.get against a scope built from the merge-field dictionary and the enclosing
// repeating block — a prototype-free lookup by construction. There is no `.` operator to walk with and
// no host object to walk, which is why the `__proto__` family is uninteresting here: it is one atom,
// looked up, absent, and reported as an unknown merge field.

export type NameOrigin = "dictionary" | "loop";

export interface NameBinding {
  readonly type: ExpressionType;
  readonly origin: NameOrigin;
  // For a `list` binding: the fields one item of the collection carries, which is what a repeating
  // block pushes into scope. Absent for a scalar binding and for a list of bare scalars.
  readonly itemFields?: ReadonlyMap<string, ExpressionType>;
}

// A scope is a Map, layered by copying rather than by prototype chaining: an inherited scope built by
// `Object.create` would put a template-supplied name one lookup away from a prototype property.
export type ExpressionScope = ReadonlyMap<string, NameBinding>;

export function layerScope(
  base: ExpressionScope,
  frame: ReadonlyMap<string, NameBinding>,
): ExpressionScope {
  return new Map([...base, ...frame]);
}

// The names a repeating block pushes: the current item's fields, plus the four positional facts every
// loop carries. `loop.value` is present when the collection's items are bare scalars — which is what
// `allocate` produces, since its parts have no field names of their own.
export const LOOP_POSITION_NAMES: readonly string[] = [
  "loop.index",
  "loop.count",
  "loop.first",
  "loop.last",
  "loop.value",
];

export function loopFrame(
  collectionKey: string,
  itemFields: ReadonlyMap<string, ExpressionType> | undefined,
  itemScalarType: ExpressionType | undefined,
): ReadonlyMap<string, NameBinding> {
  const frame = new Map<string, NameBinding>([
    ["loop.index", { type: "number", origin: "loop" }],
    ["loop.count", { type: "number", origin: "loop" }],
    ["loop.first", { type: "boolean", origin: "loop" }],
    ["loop.last", { type: "boolean", origin: "loop" }],
  ]);
  if (itemScalarType !== undefined) {
    frame.set("loop.value", { type: itemScalarType, origin: "loop" });
  }
  for (const [field, type] of itemFields ?? new Map<string, ExpressionType>()) {
    frame.set(`${collectionKey}.${field}`, { type, origin: "loop" });
  }
  return frame;
}

// What the site the expression sits at requires of its result.
export type RequiredResult =
  // A condition: `{{#if}}` / `{{#unless}}`.
  | "boolean"
  // A repeat's source.
  | "list"
  // A computed field: any scalar that a formatter can render.
  | "formattableScalar";

export interface CheckOptions {
  readonly scope: ExpressionScope;
  readonly required: RequiredResult;
  // A computed field's `:format` suffix, or null when it took the type's default. A format name is a
  // literal by grammar precisely so this check can be STATIC.
  readonly format?: string | null;
  // Which renderings are legal for a result type. Injected rather than imported so this folder stays
  // free of everything but itself — the checker has to stay runnable in a browser for the authoring
  // surface built in slice 2·6·4.
  readonly legalFormats?: (type: ExpressionType) => readonly string[];
}

export interface CheckedExpression {
  readonly source: string;
  readonly node: ExpressionNode;
  readonly resultType: ExpressionType;
  // The DICTIONARY keys this expression reads, sorted. These join the field manifest's key set, which
  // is what keeps the batching rule true once a condition can read anything the dictionary has: an
  // expression must never be the reason a read happens late.
  readonly keys: readonly string[];
  // Names resolved from an enclosing repeating block rather than from the dictionary. Recorded
  // separately because they cost no read of their own — the collection was read once, as a whole.
  readonly loopNames: readonly string[];
  readonly depth: number;
  readonly callNodes: number;
}

function failure(
  code: ExpressionFailure["code"],
  offset: number,
  detail: string,
): ExpressionFailure {
  return { code, offset, detail };
}

const ORDERABLE: ReadonlySet<ExpressionType> = new Set(["number", "money", "date"]);
const EQUATABLE: ReadonlySet<ExpressionType> = new Set([
  "text",
  "number",
  "money",
  "rate",
  "date",
  "boolean",
]);

interface CheckState {
  readonly scope: ExpressionScope;
  readonly keys: Set<string>;
  readonly loopNames: Set<string>;
  failure: ExpressionFailure | undefined;
}

function resolveName(node: ExpressionNode & { kind: "name" }, state: CheckState): ExpressionType {
  const binding = state.scope.get(node.name);
  if (binding === undefined) {
    state.failure ??= failure(
      "expression-unknown-key",
      node.offset,
      node.name.startsWith("loop.")
        ? `"${node.name}" only means something inside a repeating block.`
        : `"${node.name}" is not a merge field this firm has. Check the field list for the spelling.`,
    );
    return "text";
  }
  if (binding.origin === "dictionary") state.keys.add(node.name);
  else state.loopNames.add(node.name);
  return binding.type;
}

// `default`, `choose`, and every helper whose result echoes an argument tie their parameters to earlier
// ones. Resolved left to right, so the tie is always to a type already known.
function resolveParameter(
  specification: ParameterSpecification,
  argumentTypes: readonly ExpressionType[],
): ParameterSpecification {
  if (specification === "sameAsFirst") return argumentTypes[0] ?? "scalar";
  if (specification === "sameAsSecond") return argumentTypes[1] ?? "scalar";
  return specification;
}

function parameterAccepts(specification: ParameterSpecification, type: ExpressionType): boolean {
  if (specification === "scalar") return type !== "list";
  if (specification === "integer") return type === "number";
  if (specification === "mergeKey") return true; // shape-checked separately: it must be a NAME
  if (specification === "listField") return true; // likewise: it must be a NAME naming a collection field
  if (specification === "personSubject") return true; // likewise: it must be a NAME naming a person subject
  if (specification === "pronounForm") return true; // likewise: it must be a text LITERAL
  if (specification === "sameAsFirst" || specification === "sameAsSecond") return true;
  return specification === type;
}

// The dictionary key whose presence DEFINES a subject as one the document can speak about as a
// person. A subject gains it when the read behind it joins a Directory person, so the set of legal
// first arguments to a pronoun helper is derived from the firm's own field catalogue rather than
// listed a second time here.
export const PRONOUN_SUBJECT_FACET = "pronouns";

export function pronounSubjectKey(subject: string): string {
  return `${subject}.${PRONOUN_SUBJECT_FACET}`;
}

// Every subject a pronoun helper will accept, in the order the catalogue declares them — the list a
// failure message shows an author who named something else.
function personSubjectsIn(scope: ExpressionScope): string[] {
  const subjects: string[] = [];
  const suffix = `.${PRONOUN_SUBJECT_FACET}`;
  for (const [key, binding] of scope) {
    if (binding.origin === "dictionary" && key.endsWith(suffix)) {
      subjects.push(key.slice(0, key.length - suffix.length));
    }
  }
  return subjects;
}

// A pronoun helper's first argument, resolved at REGISTRATION. The atom names a SUBJECT, not a
// value: there is no value in this language that carries a person, and a pronoun is a fact about
// whose it is. Resolving it here means an author who writes `pronoun(defendant, "subject")` on a
// firm whose catalogue has no defendant subject learns it while looking at the template.
function resolvePersonSubject(
  helper: HelperSignature,
  argument: ExpressionNode,
  state: CheckState,
): void {
  if (argument.kind !== "name") {
    state.failure ??= failure(
      "expression-type-error",
      argument.offset,
      `${helper.name} takes the name of a person on the matter, written out — as in ${helper.name}(client, "subject") — rather than a calculation.`,
    );
    return;
  }
  const key = pronounSubjectKey(argument.name);
  const binding = state.scope.get(key);
  if (binding === undefined) {
    const available = personSubjectsIn(state.scope);
    state.failure ??= failure(
      "expression-unknown-key",
      argument.offset,
      available.length === 0
        ? `"${argument.name}" is not someone this firm's fields can name.`
        : `"${argument.name}" is not someone this firm's fields can name. Write one of: ${available.join(", ")}.`,
    );
    return;
  }
  // The pronoun set travels with the subject's own read, so recording the key is what puts that read
  // in the manifest's plan — the same accounting every other dictionary name gets.
  state.keys.add(key);
}

// A pronoun helper's form argument. A LITERAL by requirement, so "subjekt" is a registration error
// with a character offset rather than a word missing from a filed document.
function resolvePronounForm(
  helper: HelperSignature,
  argument: ExpressionNode,
  state: CheckState,
): void {
  if (argument.kind !== "text") {
    state.failure ??= failure(
      "expression-type-error",
      argument.offset,
      `${helper.name} takes the grammatical position written out in quotes, as in ${helper.name}(client, "subject").`,
    );
    return;
  }
  if (!isPronounForm(argument.value)) {
    state.failure ??= failure(
      "expression-type-error",
      argument.offset,
      `"${argument.value}" is not a grammatical position. Write one of: ${PRONOUN_FORMS.join(", ")}.`,
    );
  }
}

// An aggregate's argument, resolved at REGISTRATION: the atom has to name a field that one item of a
// list-valued key carries, and that field's type has to be one the helper can fold. Every way this can
// be wrong is an authoring mistake with a character offset, never an assembly surprise — which is the
// whole reason the stage exists.
function resolveListField(
  helper: HelperSignature,
  argument: ExpressionNode,
  state: CheckState,
): ExpressionType {
  if (argument.kind !== "name") {
    state.failure ??= failure(
      "expression-type-error",
      argument.offset,
      `${helper.name} takes the name of a field on a list, written out — as in ${helper.name}(matter.parties.role) — rather than a calculation.`,
    );
    return "number";
  }

  const path = splitListFieldPath(argument.name);
  if (path === undefined) {
    state.failure ??= failure(
      "expression-unknown-key",
      argument.offset,
      `"${argument.name}" does not name a field on a list. Write the collection and then the field, as in ${helper.name}(matter.parties.role).`,
    );
    return "number";
  }

  const binding = state.scope.get(path.collectionKey);
  if (binding === undefined) {
    state.failure ??= failure(
      "expression-unknown-key",
      argument.offset,
      `"${path.collectionKey}" is not a merge field this firm has. Check the field list for the spelling.`,
    );
    return "number";
  }
  if (binding.type !== "list") {
    state.failure ??= failure(
      "expression-type-error",
      argument.offset,
      `${helper.name} works across the items of a list, and "${path.collectionKey}" is ${describeType(binding.type)}.`,
    );
    return "number";
  }

  const fieldType = binding.itemFields?.get(path.fieldName);
  if (fieldType === undefined) {
    state.failure ??= failure(
      "expression-unknown-key",
      argument.offset,
      `the items of "${path.collectionKey}" carry no field called "${path.fieldName}".`,
    );
    return "number";
  }

  const admissible = helper.elementTypes ?? [];
  if (!admissible.includes(fieldType)) {
    state.failure ??= failure(
      "expression-type-error",
      argument.offset,
      `${helper.name} works across ${admissible.map(describeType).join(" or ")}, and "${path.fieldName}" is ${describeType(fieldType)}.`,
    );
    return "number";
  }

  // The COLLECTION is what gets read, once and as a whole; the field costs no read of its own. Recording
  // the collection rather than the path is what keeps the manifest's read plan honest.
  if (binding.origin === "dictionary") state.keys.add(path.collectionKey);
  else state.loopNames.add(path.collectionKey);
  return fieldType;
}

function describeParameter(specification: ParameterSpecification): string {
  switch (specification) {
    case "scalar":
      return "a single value";
    case "integer":
      return "a whole number";
    case "mergeKey":
      return "the name of a merge field";
    case "listField":
      return "the name of a field on a list";
    case "personSubject":
      return "the name of a person on the matter";
    case "pronounForm":
      return "a grammatical position in quotes";
    case "sameAsFirst":
    case "sameAsSecond":
      return "a value of the same kind as the one before it";
    case "list":
      return "a list";
    default:
      return `a ${specification} value`;
  }
}

function typeOf(node: ExpressionNode, state: CheckState): ExpressionType {
  if (state.failure !== undefined) return "text";
  switch (node.kind) {
    case "text":
      return "text";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "name":
      return resolveName(node, state);

    case "not": {
      const operand = typeOf(node.operand, state);
      if (operand !== "boolean") {
        state.failure ??= failure(
          "expression-type-error",
          node.offset,
          `"not" needs something that is either true or false, and this is ${describeType(operand)}.`,
        );
      }
      return "boolean";
    }

    case "and":
    case "or": {
      const left = typeOf(node.left, state);
      const right = typeOf(node.right, state);
      if (left !== "boolean" || right !== "boolean") {
        state.failure ??= failure(
          "expression-type-error",
          node.offset,
          `"${node.kind}" joins two things that are either true or false; here one side is ${describeType(left !== "boolean" ? left : right)}.`,
        );
      }
      return "boolean";
    }

    case "compare": {
      const left = typeOf(node.left, state);
      const right = typeOf(node.right, state);
      if (left !== right) {
        state.failure ??= failure(
          "expression-type-error",
          node.offset,
          `${describeType(left)} and ${describeType(right)} cannot be compared with each other.`,
        );
        return "boolean";
      }
      const equality = node.operator === "==" || node.operator === "!=";
      if (equality && !EQUATABLE.has(left)) {
        state.failure ??= failure(
          "expression-type-error",
          node.offset,
          "a list cannot be compared. Ask isEmpty or count about it instead.",
        );
      }
      if (!equality && !ORDERABLE.has(left)) {
        state.failure ??= failure(
          "expression-type-error",
          node.offset,
          `${describeType(left)} has no order, so it can only be tested with == or !=.`,
        );
      }
      return "boolean";
    }

    case "membership": {
      const subject = typeOf(node.subject, state);
      for (const option of node.options) {
        const optionType = typeOf(option, state);
        if (optionType !== subject) {
          state.failure ??= failure(
            "expression-type-error",
            option.offset,
            `the list after "in" holds ${describeType(optionType)} but is being compared with ${describeType(subject)}.`,
          );
          break;
        }
      }
      if (!EQUATABLE.has(subject)) {
        state.failure ??= failure(
          "expression-type-error",
          node.offset,
          'a list cannot be tested with "in".',
        );
      }
      return "boolean";
    }

    case "add":
    case "subtract": {
      const left = typeOf(node.left, state);
      const right = typeOf(node.right, state);
      if (left === "number" && right === "number") return "number";
      if (left === "money" && right === "money") return "money";
      if (left === "date" || right === "date") {
        state.failure ??= failure(
          "expression-type-error",
          node.offset,
          "dates are not added with + or -. Use addDays, addMonths, or addYears, and daysBetween for the gap between two of them.",
        );
        return "date";
      }
      if (left === "text" || right === "text") {
        state.failure ??= failure(
          "expression-type-error",
          node.offset,
          'text is not joined with +. Use concat("one", "the other").',
        );
        return "text";
      }
      state.failure ??= failure(
        "expression-type-error",
        node.offset,
        `${describeType(left)} and ${describeType(right)} cannot be added together. An amount of money adds only to another amount in the same currency.`,
      );
      return left;
    }

    case "multiply": {
      const left = typeOf(node.left, state);
      const right = typeOf(node.right, state);
      if (left === "number" && right === "number") return "number";
      if (left === "money" && right === "number") return "money";
      if (left === "number" && right === "money") return "money";
      state.failure ??= failure(
        "expression-type-error",
        node.offset,
        left === "money" && right === "money"
          ? "two amounts of money cannot be multiplied together — the result would not be money."
          : `${describeType(left)} and ${describeType(right)} cannot be multiplied. An amount of money multiplies only by a whole number; for a rate use applyRate, and for a fraction use percentOf.`,
      );
      return left;
    }

    case "negate": {
      const operand = typeOf(node.operand, state);
      if (operand !== "number" && operand !== "money") {
        state.failure ??= failure(
          "expression-type-error",
          node.offset,
          `${describeType(operand)} has no negative.`,
        );
      }
      return operand;
    }

    case "call": {
      const helper = node.helper;
      const argumentTypes: ExpressionType[] = [];
      for (let index = 0; index < node.argumentNodes.length; index += 1) {
        const argument = node.argumentNodes[index] as ExpressionNode;
        const fixed = helper.parameters[index];
        const specification = resolveParameter(fixed ?? helper.variadic ?? "scalar", argumentTypes);

        // `has` asks whether a NAMED field resolved, which is a question about a name rather than about
        // a value. Admitting an expression there would make it a question nobody could answer.
        if (specification === "mergeKey") {
          if (argument.kind !== "name") {
            state.failure ??= failure(
              "expression-type-error",
              argument.offset,
              `${helper.name} takes the name of a merge field, written out, rather than a calculation.`,
            );
            argumentTypes.push("text");
            continue;
          }
          resolveName(argument, state);
          argumentTypes.push("boolean");
          continue;
        }

        // A pronoun helper's subject is likewise a NAME, and its form a LITERAL — neither is
        // evaluated. Both push `text` so the arity and result accounting below stay uniform, and
        // both are settled here rather than at assembly, where a typo would be a wrong word on a
        // filed page instead of a message under a template an author is still editing.
        if (specification === "personSubject") {
          resolvePersonSubject(helper, argument, state);
          argumentTypes.push("text");
          if (state.failure !== undefined) break;
          continue;
        }
        if (specification === "pronounForm") {
          resolvePronounForm(helper, argument, state);
          argumentTypes.push("text");
          if (state.failure !== undefined) break;
          continue;
        }

        // An aggregate's field path is likewise a NAME, resolved against the collection it names rather
        // than evaluated: the atom means nothing on its own outside a repeating block.
        if (specification === "listField") {
          argumentTypes.push(resolveListField(helper, argument, state));
          if (state.failure !== undefined) break;
          continue;
        }

        const argumentType = typeOf(argument, state);
        argumentTypes.push(argumentType);
        if (state.failure !== undefined) break;
        if (!parameterAccepts(specification, argumentType)) {
          state.failure ??= failure(
            "expression-type-error",
            argument.offset,
            `${helper.name} expects ${describeParameter(specification)} in position ${index + 1}, and this is ${describeType(argumentType)}.`,
          );
          break;
        }
      }

      const arity = helperArity(helper);
      if (node.argumentNodes.length < arity.minimum) {
        state.failure ??= failure(
          "expression-type-error",
          node.offset,
          `${helper.name} needs at least ${arity.minimum} input${arity.minimum === 1 ? "" : "s"}.`,
        );
      }

      if (helper.result === "sameAsFirst" || helper.result === "fieldOfFirst") {
        return argumentTypes[0] ?? "text";
      }
      if (helper.result === "sameAsSecond") return argumentTypes[1] ?? "text";
      return helper.result;
    }
  }
}

export function describeType(type: ExpressionType): string {
  switch (type) {
    case "text":
      return "text";
    case "number":
      return "a number";
    case "money":
      return "an amount of money";
    case "rate":
      return "a rate";
    case "date":
      return "a date";
    case "boolean":
      return "something that is either true or false";
    case "list":
      return "a list";
  }
}

export function checkExpression(
  source: string,
  options: CheckOptions,
): ExpressionOutcome<CheckedExpression> {
  const parsed = parse(source);
  if (!parsed.ok) return parsed;

  const state: CheckState = {
    scope: options.scope,
    keys: new Set(),
    loopNames: new Set(),
    failure: undefined,
  };
  const resultType = typeOf(parsed.value.node, state);
  if (state.failure !== undefined) return { ok: false, failure: state.failure };

  if (state.keys.size > EXPRESSION_LIMITS.keysPerExpression) {
    return {
      ok: false,
      failure: failure(
        "expression-too-complex",
        0,
        `an expression may read at most ${EXPRESSION_LIMITS.keysPerExpression} merge fields; this one reads ${state.keys.size}.`,
      ),
    };
  }

  const siteFailure = checkSite(resultType, source, options, parsed.value.node.offset);
  if (siteFailure !== undefined) return { ok: false, failure: siteFailure };

  return expressionSucceeded({
    source,
    node: parsed.value.node,
    resultType,
    keys: [...state.keys].sort(),
    loopNames: [...state.loopNames].sort(),
    depth: parsed.value.depth,
    callNodes: parsed.value.callNodes,
  });
}

function checkSite(
  resultType: ExpressionType,
  source: string,
  options: CheckOptions,
  offset: number,
): ExpressionFailure | undefined {
  if (options.required === "boolean") {
    return resultType === "boolean"
      ? undefined
      : failure(
          "expression-type-error",
          offset,
          `a condition has to work out to yes or no, and "${source}" works out to ${describeType(resultType)}.`,
        );
  }

  if (options.required === "list") {
    return resultType === "list"
      ? undefined
      : failure(
          "expression-type-error",
          offset,
          `a repeating block walks a list, and "${source}" is ${describeType(resultType)}.`,
        );
  }

  if (resultType === "list") {
    return failure(
      "expression-type-error",
      offset,
      "a list cannot be written into a document. A repeating block walks it; count and isEmpty ask about it.",
    );
  }

  const format = options.format ?? null;
  // A bare boolean in a document renders as the word "true", which is not a thing a filed document
  // should say. The intent is written out — choose(x, "Yes", "No"), or the yesNo rendering.
  if (resultType === "boolean" && format === null) {
    return failure(
      "expression-format-illegal",
      offset,
      'a yes-or-no calculation needs a rendering: write it as :yesNo, or as choose(condition, "Yes", "No").',
    );
  }

  if (format !== null && options.legalFormats !== undefined) {
    const legal = options.legalFormats(resultType);
    if (!legal.includes(format)) {
      return failure(
        "expression-format-illegal",
        offset,
        `"${format}" is not a rendering ${describeType(resultType)} supports. This one takes ${legal.join(", ")}.`,
      );
    }
  }

  return undefined;
}
