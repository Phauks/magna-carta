import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readFields, readPublishedFormByToken, type IntakeFormRow } from "./form-statements.ts";
import type { PublicIntakeFormView } from "./types.ts";
import type { AnswerableField } from "./validation.ts";

// THE ANONYMOUS READ — the only thing a stranger can make this platform do before a member has
// decided they exist.
//
// One rule shapes it, and it is the rule that is easiest to break by being helpful: EVERY
// UNRESOLVABLE CASE IS THE SAME CASE. A token that never existed, a token that was rotated away, a
// form still in draft, and a form the firm has closed all resolve to `undefined` here — not to four
// outcomes a route then maps to four status codes. A 404 for an unknown token beside a 403 for a
// closed one turns the endpoint into an oracle for which forms a firm has and what state they are
// in, and the person probing for that is not the person the form is for.
//
// The status filter therefore lives in the SQL (`readPublishedFormByToken`) rather than in a branch
// out here. A route that fetched the row and then decided would answer measurably differently for a
// form that exists than for one that does not, which is the same leak reached through the clock
// instead of the status code.

/** A published form, resolved by the token in the URL. `undefined` for every case that is not one. */
export interface ResolvedPublicForm {
  readonly form: IntakeFormRow;
  readonly view: PublicIntakeFormView;
  /** The same fields, in the shape the submission validator takes. */
  readonly answerable: readonly AnswerableField[];
}

/**
 * Resolve what the page renders and what a submission is validated against, in one read pair.
 *
 * Both halves come from the same version, which is what makes a submission answerable against
 * exactly the questions the visitor saw. Reading them apart — the view now, the fields again at
 * submission time — would open a window where a republish between the two silently re-captions
 * somebody's answers.
 */
export async function resolvePublicForm(
  database: SqlDatabase,
  publicToken: string,
): Promise<ResolvedPublicForm | undefined> {
  const form = await readPublishedFormByToken(database, publicToken);
  // Belt and braces with the SQL's own filter: the CHECK makes a published form with no version
  // impossible to commit, so this is unreachable — and it is here because "unreachable" is a claim
  // about today's schema, and the failure it would otherwise produce is a page with no questions.
  if (form?.published_version_id == null) return undefined;

  const rows = await readFields(database, form.published_version_id);

  const answerable: AnswerableField[] = rows.map((row) => ({
    fieldId: row.id,
    kind: row.kind,
    label: row.label,
    required: row.required === 1,
    options: parseOptions(row.options_json),
  }));

  return {
    form,
    view: {
      title: form.title,
      introduction: form.introduction,
      // What crosses to the page: the questions, and nothing about the firm. No name, no member, no
      // matter type, no count. Every value here is one the firm chose to put in front of a stranger
      // by authoring it.
      fields: rows.map((row) => ({
        fieldId: row.id,
        kind: row.kind,
        label: row.label,
        helpText: row.help_text,
        required: row.required === 1,
        options: parseOptions(row.options_json),
      })),
    },
    answerable,
  };
}

/**
 * Read a field's stored choices.
 *
 * Malformed JSON becomes no options rather than an exception. The column is written only by the
 * authoring service, which serializes an array it validated — so a value that does not parse means
 * the row was written by something else, and taking down a firm's public form over it is the wrong
 * trade. A choice field with no options renders as a picker with nothing in it, which the firm sees
 * the moment they look at their own form.
 */
function parseOptions(optionsJson: string | null): readonly string[] | null {
  if (optionsJson === null) return null;
  try {
    const parsed: unknown = JSON.parse(optionsJson);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((option): option is string => typeof option === "string");
  } catch {
    return null;
  }
}
