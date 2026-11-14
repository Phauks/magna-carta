import { describe, expect, it } from "vitest";
import type { MeetingMessage } from "@magna-carta/api-client";
import type { MeetingQuestionView } from "../src/lib/meetings/client/questions.svelte.ts";
import { chatTimeline } from "../src/lib/meetings/screen/chat-timeline.ts";

const message = (id: string, sentAt: string) => ({ id, sentAt }) as unknown as MeetingMessage;
const question = (questionId: string, askedAt: string) =>
  ({ questionId, askedAt }) as unknown as MeetingQuestionView;

describe("chatTimeline", () => {
  it("puts messages and questions in the order they were said", () => {
    const entries = chatTimeline(
      [message("a", "2026-11-13T10:00:00.000Z"), message("b", "2026-11-13T10:02:00.000Z")],
      [question("q", "2026-11-13T10:01:00.000Z")],
    );
    expect(entries.map((entry) => entry.key)).toEqual(["message:a", "question:q", "message:b"]);
  });

  it("orders a tie the same way every time", () => {
    const at = "2026-11-13T10:00:00.000Z";
    const first = chatTimeline([message("a", at)], [question("q", at)]);
    const second = chatTimeline([message("a", at)], [question("q", at)]);
    expect(first.map((entry) => entry.key)).toEqual(second.map((entry) => entry.key));
  });
});
