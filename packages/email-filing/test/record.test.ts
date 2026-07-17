import { describe, expect, it } from "vitest";
import type {
  EmailMessageId,
  EmailParticipantId,
  EmailThreadId,
} from "@magna-carta/identifiers/types";
import { toRecordRows, type RecordContext } from "../src/record.ts";
import { makeParsedMessage } from "./fixtures.ts";

function makeContext(overrides: Partial<RecordContext> = {}): RecordContext {
  let counter = 0;
  return {
    emailMessageId: "emailMessage_a" as EmailMessageId,
    threadId: "emailThread_a" as EmailThreadId,
    isNewThread: true,
    dedupKey: "messageId:header:<a@example.com>",
    contentSha256: "abc123",
    originalR2Key: "emails/emailMessage_a/original",
    capturedVia: "api",
    receivedAt: "2026-07-17T10:00:00.000Z",
    mintParticipantId: () => `emailParticipant_${(counter += 1)}` as EmailParticipantId,
    ...overrides,
  };
}

describe("toRecordRows", () => {
  it("maps the message, participants (from/to/cc/bcc), and a new-thread row", () => {
    const message = makeParsedMessage({
      cc: [{ displayName: "Carol", address: "carol@example.com" }],
      bcc: [{ displayName: null, address: "blind@example.com" }],
    });
    const rows = toRecordRows(message, makeContext());

    expect(rows.message.messageIdProvenance).toBe("header");
    expect(rows.message.dkimVerdict).toBe("unverified"); // recorded, never adjudicated here
    expect(rows.message.integrity).toBe(JSON.stringify(message.integrity));
    expect(rows.message.fromAddress).toBe("alice@example.com");
    expect(rows.message.sentAt).toBe("2026-07-15T09:00:00.000Z");
    expect(rows.message.receivedAt).toBe("2026-07-17T10:00:00.000Z");

    expect(rows.thread).not.toBe(null);
    expect(rows.thread?.subjectNormalized).toBe("matter update");

    const kinds = rows.participants.map((p) => p.kind);
    expect(kinds).toEqual(["from", "to", "cc", "bcc"]);
    expect(rows.participants.every((p) => p.directoryEntityId === null)).toBe(true); // no resolver → null
  });

  it("omits the thread row when joining an existing thread", () => {
    const rows = toRecordRows(makeParsedMessage(), makeContext({ isNewThread: false }));
    expect(rows.thread).toBe(null);
  });

  it("resolves a participant to a Directory entity when the resolver map has the address", () => {
    const rows = toRecordRows(
      makeParsedMessage(),
      makeContext({
        directoryEntityIdByAddress: new Map([["alice@example.com", "directoryPerson_alice"]]),
      }),
    );
    const from = rows.participants.find((p) => p.kind === "from");
    const to = rows.participants.find((p) => p.kind === "to");
    expect(from?.directoryEntityId).toBe("directoryPerson_alice");
    expect(to?.directoryEntityId).toBe(null); // not in the resolver map → left null, not faked
  });

  it("leaves sentAt null when the Date header is unparseable", () => {
    const rows = toRecordRows(makeParsedMessage({ dateRaw: "not a date" }), makeContext());
    expect(rows.message.sentAt).toBe(null);
  });
});
