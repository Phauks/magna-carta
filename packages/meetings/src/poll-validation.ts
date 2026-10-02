import {
  MAX_MEETING_POLL_OPTIONS,
  MAX_MEETING_POLL_OPTION_LENGTH,
  MAX_MEETING_POLL_QUESTION_LENGTH,
  MIN_MEETING_POLL_OPTIONS,
} from "./poll-types.ts";

// A poll's own refusals, as codes the route maps to problem types. A SEPARATE union from the room's
// (`./validation.ts`) and the chat's, on the chat's reasoning: those are about reaching a meeting and
// saying something in it, these are about a poll inside one. Answering from outside the room is the
// room's own `meeting-not-joined`, and a host act without a grant is the room's `meeting-not-host` —
// a second code for either would let the answers drift apart.
export type MeetingPollValidationCode =
  // A poll handle that names nothing, and a poll in another meeting. One refusal for both, on the
  // rule the room holds for an unknown event: telling them apart would make the route an existence
  // oracle.
  | "meeting-poll-not-found"
  // Closed by a host, so it takes no more answers.
  | "meeting-poll-closed"
  // This stay — or another stay of the same member in this meeting — has already answered. An answer
  // is a thing somebody said in a meeting and cannot be changed; a host who wants the room asked
  // again opens a second poll, which is also the honest record of having asked twice.
  | "meeting-poll-already-answered"
  // Who answered what was asked of a poll that does not show names. Refused rather than answered
  // with an empty page, which would read as "nobody answered" and is the one wrong answer.
  | "meeting-poll-answers-not-attributed"
  // The question, the option count, an option's length, the choices allowed, or the choices made.
  // ONE code for all of them because they are one validation of one body; `field` says which.
  | "meeting-poll-invalid";

/** Which part of a poll body failed, named for the caller's own field. */
export type MeetingPollInvalidField = "question" | "options" | "maxChoices" | "optionIds";

export class MeetingPollValidationError extends Error {
  constructor(
    readonly code: MeetingPollValidationCode,
    message: string,
    readonly field?: MeetingPollInvalidField,
  ) {
    super(message);
    this.name = "MeetingPollValidationError";
  }
}

export function refusePoll(
  code: MeetingPollValidationCode,
  message: string,
  field?: MeetingPollInvalidField,
): never {
  throw new MeetingPollValidationError(code, message, field);
}

function invalid(field: MeetingPollInvalidField, message: string): never {
  refusePoll("meeting-poll-invalid", message, field);
}

/**
 * The poll as it will be stored, or a refusal naming the field that failed.
 *
 * TRIMMED AT THE EDGES AND NOWHERE ELSE, and measured after the trim, on the chat's reasoning: the
 * database's CHECK measures what is stored, and a trailing newline is not part of the question.
 *
 * Two options that say the same thing are refused. A tally with two bars for one answer splits the
 * room's choice in half and nobody reading it can tell.
 */
export function assertPollBody(input: {
  readonly question: string;
  readonly options: readonly string[];
  readonly maxChoices: number;
}): { question: string; options: readonly string[]; maxChoices: number } {
  const question = input.question.trim();
  if (question.length === 0) invalid("question", "a poll has to ask something");
  if (question.length > MAX_MEETING_POLL_QUESTION_LENGTH) {
    invalid(
      "question",
      `a poll's question holds ${String(MAX_MEETING_POLL_QUESTION_LENGTH)} characters at most`,
    );
  }
  if (
    input.options.length < MIN_MEETING_POLL_OPTIONS ||
    input.options.length > MAX_MEETING_POLL_OPTIONS
  ) {
    invalid(
      "options",
      `a poll offers between ${String(MIN_MEETING_POLL_OPTIONS)} and ` +
        `${String(MAX_MEETING_POLL_OPTIONS)} options`,
    );
  }
  const options = input.options.map((option) => option.trim());
  for (const option of options) {
    if (option.length === 0) invalid("options", "every option has to say something");
    if (option.length > MAX_MEETING_POLL_OPTION_LENGTH) {
      invalid(
        "options",
        `an option holds ${String(MAX_MEETING_POLL_OPTION_LENGTH)} characters at most`,
      );
    }
  }
  if (new Set(options).size !== options.length) {
    invalid("options", "two options say the same thing");
  }
  if (
    !Number.isInteger(input.maxChoices) ||
    input.maxChoices < 1 ||
    input.maxChoices > options.length
  ) {
    invalid("maxChoices", "a participant chooses at least one option and no more than there are");
  }
  return { question, options, maxChoices: input.maxChoices };
}

/**
 * The choices one participation makes, checked against the poll it answers.
 *
 * At least one, none twice, no more than the poll allows, and every one an option of THIS poll. The
 * last is also held by the database — the answer names its option as the pair (poll, option) against
 * the option table's own pair — so this is the reason a member reads rather than the guard itself.
 */
export function assertAnswerChoices(
  optionIds: readonly string[],
  poll: { readonly maxChoices: number; readonly optionIds: ReadonlySet<string> },
): readonly string[] {
  if (optionIds.length === 0) invalid("optionIds", "an answer chooses at least one option");
  if (new Set(optionIds).size !== optionIds.length) {
    invalid("optionIds", "an answer names each option once");
  }
  if (optionIds.length > poll.maxChoices) {
    invalid("optionIds", `this poll allows ${String(poll.maxChoices)} choices at most`);
  }
  for (const optionId of optionIds) {
    if (!poll.optionIds.has(optionId)) invalid("optionIds", "that is not an option of this poll");
  }
  return optionIds;
}
