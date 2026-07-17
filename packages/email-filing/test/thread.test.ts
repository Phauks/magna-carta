import { describe, expect, it } from "vitest";
import type { EmailThreadId } from "@magna-carta/identifiers/types";
import { candidateParents, linkThread, normalizeSubject } from "../src/thread.ts";
import { makeParsedMessage } from "./fixtures.ts";

const NEW_THREAD = "emailThread_new" as EmailThreadId;
const EXISTING_THREAD = "emailThread_existing" as EmailThreadId;

describe("linkThread", () => {
  it("joins the parent's thread when In-Reply-To resolves to an existing message", () => {
    const reply = makeParsedMessage({
      messageIdentifier: { value: "<reply@example.com>", provenance: "header" },
      inReplyTo: "<parent@example.com>",
    });
    const lookup = (id: string): EmailThreadId | undefined =>
      id === "<parent@example.com>" ? EXISTING_THREAD : undefined;
    const decision = linkThread(reply, lookup, NEW_THREAD);
    expect(decision.isNewThread).toBe(false);
    expect(decision.threadId).toBe(EXISTING_THREAD);
    expect(decision.parentMessageId).toBe("<parent@example.com>");
  });

  it("opens a new thread for a message whose ancestors are unseen", () => {
    const root = makeParsedMessage({ inReplyTo: null, references: [] });
    const decision = linkThread(root, () => undefined, NEW_THREAD);
    expect(decision.isNewThread).toBe(true);
    expect(decision.threadId).toBe(NEW_THREAD);
    expect(decision.parentMessageId).toBe(null);
  });

  it("resolves through References (DAG) when In-Reply-To is absent", () => {
    const message = makeParsedMessage({
      inReplyTo: null,
      references: ["<root@example.com>", "<mid@example.com>"],
    });
    const lookup = (id: string): EmailThreadId | undefined =>
      id === "<root@example.com>" ? EXISTING_THREAD : undefined;
    const decision = linkThread(message, lookup, NEW_THREAD);
    expect(decision.threadId).toBe(EXISTING_THREAD);
    // The nearest claimed parent is the last References entry.
    expect(decision.parentMessageId).toBe("<mid@example.com>");
  });

  it("two unrelated messages open two distinct threads", () => {
    const a = linkThread(makeParsedMessage({ references: [] }), () => undefined, "emailThread_a" as EmailThreadId);
    const b = linkThread(makeParsedMessage({ references: [] }), () => undefined, "emailThread_b" as EmailThreadId);
    expect(a.threadId).not.toBe(b.threadId);
    expect(a.isNewThread && b.isNewThread).toBe(true);
  });
});

describe("candidateParents", () => {
  it("orders In-Reply-To first, then References newest→oldest, deduped", () => {
    const message = makeParsedMessage({
      inReplyTo: "<direct@example.com>",
      references: ["<a@example.com>", "<b@example.com>", "<direct@example.com>"],
    });
    expect(candidateParents(message)).toEqual([
      "<direct@example.com>",
      "<b@example.com>",
      "<a@example.com>",
    ]);
  });
});

describe("normalizeSubject", () => {
  it("strips stacked reply/forward prefixes and normalizes", () => {
    expect(normalizeSubject("Re: Fwd:  Quarterly Report ")).toBe("quarterly report");
    expect(normalizeSubject(null)).toBe(null);
  });
});
