import { z } from "zod";
import {
  MAX_MEETING_POLL_OPTION_LENGTH,
  MAX_MEETING_POLL_OPTIONS,
  MAX_MEETING_POLL_QUESTION_LENGTH,
  MEETING_POLL_KINDS,
} from "./poll-types.ts";
import { MEETING_CONTRIBUTOR_KINDS } from "./types.ts";

// A meeting poll's contract: what its routes accept and answer, as plain zod named with
// `.meta({ id })`, which the contract emitter reads as the component's name. The routes are in
// apps/api-worker/src/http/routes/communications/meeting-polls.ts; the rule is in
// docs/conventions/api.md (_Where a contract shape lives_).

// THE BOUNDS HERE ARE SANITY BOUNDS, AND THE DOMAIN'S ARE THE CONTRACT. Each is generous by the
// whitespace a browser leaves behind and by a margin on the counts, so an ordinary overreach reaches
// the domain and is answered `meeting-poll-invalid` naming the field — one problem type a surface
// can act on — while an absurd body is refused before it is read.
export const OpenMeetingPollRequest = z
  .object({
    question: z.string().max(MAX_MEETING_POLL_QUESTION_LENGTH + 64),
    options: z
      .array(z.string().max(MAX_MEETING_POLL_OPTION_LENGTH + 64))
      .max(MAX_MEETING_POLL_OPTIONS * 2),
    // Whether the answers are kept without names. The panel says "Answers are not shown with names"
    // rather than "anonymous", because a reader with the raw database could still correlate rows —
    // what is promised is that no route, export, frame or audit row names who chose what.
    anonymous: z.boolean(),
    // How many options one participant may choose. One is an ordinary poll.
    maxChoices: z.number().int().default(1),
    // What kind of question: pick one, pick several, put them all in order, or give a score (whose
    // options are the scale's points, "1" upward). Without it, the kind follows `maxChoices`.
    kind: z.enum(MEETING_POLL_KINDS).optional(),
  })
  .meta({ id: "OpenMeetingPollRequest" });

export const AnswerMeetingPollRequest = z
  .object({
    // The options chosen — at least one, each once, no more than the poll allows, all of THIS poll.
    optionIds: z.array(z.string().min(1).max(128)).max(MAX_MEETING_POLL_OPTIONS * 2),
  })
  .meta({ id: "AnswerMeetingPollRequest" });

export const MeetingPollOption = z
  .object({
    optionId: z.string(),
    // 0-based, the order the room sees.
    position: z.number().int(),
    label: z.string(),
    // How many chose it. Every option is present, including the ones nobody chose.
    count: z.number().int(),
    // On a ranking, the average place given this option (1 is first); null on every other kind.
    averageRank: z.number().nullable(),
  })
  .meta({ id: "MeetingPollOption" });

export const MeetingPoll = z
  .object({
    id: z.string(),
    meetingId: z.string(),
    askedByUserId: z.string(),
    question: z.string(),
    anonymous: z.boolean(),
    maxChoices: z.number().int(),
    kind: z.enum(MEETING_POLL_KINDS),
    openedAt: z.string(),
    // A closed poll takes no answers; the two are set together or not at all.
    closedAt: z.string().nullable(),
    closedByUserId: z.string().nullable(),
    options: z.array(MeetingPollOption),
    // How many took part — people, not answers.
    respondents: z.number().int(),
    // Whether the CALLER has answered it, from any of their stays in this meeting — what decides
    // whether their card shows the options or the result.
    answeredByCaller: z.boolean(),
  })
  .meta({ id: "MeetingPoll" });

export const MeetingPollAnswer = z
  .object({
    // The STAY that answered, as a kind and a handle, and the firm member behind it — null for a
    // stay with no member behind it.
    participantKind: z.enum(MEETING_CONTRIBUTOR_KINDS),
    participantId: z.string(),
    userId: z.string().nullable(),
    // What it chose, in the poll's own order.
    optionIds: z.array(z.string()),
    answeredAt: z.string(),
  })
  .meta({ id: "MeetingPollAnswer" });
