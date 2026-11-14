/*
 * The chat's timeline when questions are part of it: every message and every question, oldest first,
 * by when each was said. Pure, so the merge is a unit test.
 */
import type { MeetingMessage } from "@magna-carta/api-client";
import type { MeetingQuestionView } from "$lib/meetings/client/questions.svelte.ts";

export type ChatTimelineEntry =
  | {
      readonly kind: "message";
      readonly key: string;
      readonly at: string;
      readonly message: MeetingMessage;
    }
  | {
      readonly kind: "question";
      readonly key: string;
      readonly at: string;
      readonly question: MeetingQuestionView;
    };

export function chatTimeline(
  messages: readonly MeetingMessage[],
  questions: readonly MeetingQuestionView[],
): readonly ChatTimelineEntry[] {
  const entries: ChatTimelineEntry[] = [
    ...messages.map((message) => ({
      kind: "message" as const,
      key: `message:${message.id}`,
      at: message.sentAt,
      message,
    })),
    ...questions.map((question) => ({
      kind: "question" as const,
      key: `question:${question.questionId}`,
      at: question.askedAt,
      question,
    })),
  ];
  // ISO instants sort as text; a tie keeps the key order so the list never shuffles.
  return entries.toSorted((first, second) =>
    first.at === second.at ? (first.key < second.key ? -1 : 1) : first.at < second.at ? -1 : 1,
  );
}
