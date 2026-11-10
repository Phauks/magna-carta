/*
 * The Magnus conversation's link and its downloaded transcript: the link names one conversation
 * without disturbing the page's other parameters, and the transcript is the WHOLE conversation,
 * oldest first, read across every page rather than only the pages on screen.
 */
import { describe, expect, it } from "vitest";
import type { MagnusConversation, MagnusTurn } from "../src/lib/magnus/magnus-api.ts";
import { conversationFromAddress, conversationLink } from "../src/lib/magnus/conversation-link.ts";
import {
  readWholeTranscript,
  transcriptFileName,
  transcriptMarkdown,
} from "../src/lib/magnus/transcript-export.ts";

const STARTED_AT = "2026-03-04T14:05:00.000Z";

function conversation(title: string | null): MagnusConversation {
  return {
    id: "conversation-1",
    title,
    createdBy: "member-1",
    matterId: null,
    state: "active",
    createdAt: STARTED_AT,
    updatedAt: STARTED_AT,
    folderId: null,
    pinnedAt: null,
  };
}

function turn(sequence: number, speaker: "member" | "magnus", content: string): MagnusTurn {
  return {
    id: `turn-${sequence}`,
    sequence,
    speaker,
    content,
    status: "complete",
    failureLabel: null,
    modelId: null,
    snapshotId: null,
    contextTruncated: false,
    createdAt: STARTED_AT,
    completedAt: STARTED_AT,
  };
}

describe("conversation links", () => {
  it("names the conversation and keeps the page's other parameters", () => {
    const link = conversationLink(new URL("https://firm.example/magnus?view=x#top"), "c-9");
    expect(link.searchParams.get("conversation")).toBe("c-9");
    expect(link.searchParams.get("view")).toBe("x");
    expect(link.hash).toBe("");
  });

  it("reads the conversation back from an address, and none from a blank one", () => {
    expect(conversationFromAddress(new URL("https://firm.example/magnus?conversation=c-9"))).toBe(
      "c-9",
    );
    expect(
      conversationFromAddress(new URL("https://firm.example/magnus?conversation=")),
    ).toBeNull();
    expect(conversationFromAddress(new URL("https://firm.example/magnus"))).toBeNull();
  });
});

describe("the downloaded transcript", () => {
  it("reads every page and puts the turns oldest first", async () => {
    // Two pages, each newest first, the newest page first: exactly what the API answers.
    const pages: Record<string, { data: MagnusTurn[]; nextCursor: string | null }> = {
      first: { data: [turn(4, "magnus", "D"), turn(3, "member", "C")], nextCursor: "older" },
      older: { data: [turn(2, "magnus", "B"), turn(1, "member", "A")], nextCursor: null },
    };
    const scripted = (async (input: RequestInfo | URL) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
        "https://firm.example",
      );
      const page = pages[url.searchParams.get("cursor") ?? "first"];
      return new Response(
        JSON.stringify({ conversation: conversation(null), turns: page, attachments: [] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;
    const outcome = await readWholeTranscript(scripted, "conversation-1");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.map((each) => each.content)).toEqual(["A", "B", "C", "D"]);
  });

  it("names who asked, keeps the words as typed, and states the matter", () => {
    const text = transcriptMarkdown(
      conversation("Limitation question"),
      [turn(1, "member", "How long?\nTwo lines."), turn(2, "magnus", "Four years.")],
      {
        memberName: "Trevor Goldsmith",
        matterLine: "2026-0147 · Harlow",
        downloadedAt: new Date(STARTED_AT),
      },
    );
    expect(text).toContain("# Limitation question");
    expect(text).toContain("- Matter: 2026-0147 · Harlow");
    expect(text).toContain("**Trevor Goldsmith**");
    expect(text).toContain("How long?\nTwo lines.");
    expect(text).toContain("**Magnus**");
    expect(text.indexOf("How long?")).toBeLessThan(text.indexOf("Four years."));
  });

  it("makes a safe file name and never an empty one", () => {
    expect(transcriptFileName(conversation("Brennan / carriage: limits?"))).toBe(
      "Brennan carriage limits.md",
    );
    expect(transcriptFileName(conversation("///"))).toBe("Magnus conversation.md");
  });
});
