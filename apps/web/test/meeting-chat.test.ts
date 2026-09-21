// @vitest-environment happy-dom
/*
 * What is said in a meeting, on both sides of the panel that says it.
 *
 * THE HALF THAT WOULD BE EXPENSIVE TO GET WRONG is the poll. A transcript followed from a TIMESTAMP
 * either loses a message written in the same millisecond as the last one read or reads one twice,
 * and both failures are invisible in a room where people take turns — so the cases below assert
 * that the second page continues from the cursor the first one answered with, and that the same row
 * arriving by two routes is drawn once.
 *
 * THE OTHER HALF IS WHAT A ROW SAYS ABOUT ITSELF. A message is taken back rather than deleted, so
 * the row stays and says so; a member may take back their own and somebody hosting may take back
 * any; and what is said while the panel is closed is counted, because a member watching the room
 * rather than the panel has no other way to learn that anything was said at all.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeetingMessage, MeetingMessagePage } from "@magna-carta/api-client";
import {
  CHAT_BACKSTOP_POLL_INTERVAL_MILLISECONDS,
  CHAT_POLL_INTERVAL_MILLISECONDS,
  MeetingChat,
  wasTakenBack,
  type MeetingChatSeams,
} from "$lib/meetings/client/chat.svelte.ts";
import Panel from "../src/lib/meetings/screen/meeting-chat-panel.svelte";

type PanelProps = ComponentProps<typeof Panel>;

/** One message as the record states it. */
function message(ordinal: number, over: Partial<MeetingMessage> = {}): MeetingMessage {
  return {
    id: `meetingMessage_${String(ordinal)}`,
    meetingId: "meeting_1",
    participantKind: "member",
    participantId: `attendance_${String(ordinal)}`,
    userId: `usr_${String(ordinal)}`,
    sentAt: `2026-09-20T15:0${String(ordinal)}:00.000Z`,
    body: `Message ${String(ordinal)}`,
    redactedAt: null,
    redactedByUserId: null,
    ...over,
  };
}

/**
 * A page of the transcript, answering with the key of its own last row.
 *
 * `redacted` is the OTHER half of a page: a redaction does not move a row, so a forward walk from
 * the cursor can never reach it, and the page carries the handles and instants of whatever has been
 * taken back behind the reader.
 */
function pageOf(
  messages: readonly MeetingMessage[],
  redacted: readonly { id: string; redactedAt: string }[] = [],
): MeetingMessagePage {
  return {
    data: [...messages],
    // The contract answers with a cursor for the last row of a non-empty page, and with none for a
    // page that had nothing in it.
    nextCursor: messages.length === 0 ? null : `cursor-${messages[messages.length - 1]?.id ?? ""}`,
    redacted: [...redacted],
  };
}

/** The three calls and the tick, each driven by hand. */
class Seams implements MeetingChatSeams {
  /** Every cursor a page was asked for with, in order. Null is the first ask. */
  readonly asked: (string | null)[] = [];
  readonly said: string[] = [];
  readonly takenBack: string[] = [];
  /** The pages to answer with, in order. The last one is repeated once they run out. */
  pages: MeetingMessagePage[] = [];
  sent: MeetingMessage = message(9);
  redacted: MeetingMessage = message(9, { body: "", redactedAt: "2026-09-20T15:10:00.000Z" });
  #tick: (() => void) | null = null;
  milliseconds = 0;
  /** Every interval the poll has been armed at, in order — a re-arm is a fresh entry. */
  readonly intervals: number[] = [];

  list(cursor: string | null): Promise<{ kind: "ok"; value: MeetingMessagePage }> {
    this.asked.push(cursor);
    const answer = this.pages.shift() ?? pageOf([]);
    if (this.pages.length === 0) this.pages = [];
    return Promise.resolve({ kind: "ok" as const, value: answer });
  }

  send(body: string): Promise<{ kind: "ok"; value: MeetingMessage }> {
    this.said.push(body);
    return Promise.resolve({ kind: "ok" as const, value: this.sent });
  }

  redact(messageId: string): Promise<{ kind: "ok"; value: MeetingMessage }> {
    this.takenBack.push(messageId);
    return Promise.resolve({ kind: "ok" as const, value: this.redacted });
  }

  every(milliseconds: number, tick: () => void): () => void {
    this.milliseconds = milliseconds;
    this.intervals.push(milliseconds);
    this.#tick = tick;
    return () => {
      this.#tick = null;
    };
  }

  /** One tick of the poll, and everything it set in motion. */
  async fire(): Promise<void> {
    this.#tick?.();
    await settle();
  }

  get running(): boolean {
    return this.#tick !== null;
  }
}

/** Every control on the page, wherever it was rendered — a popover is portalled to the document. */
function controls(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")];
}

/** Lets every queued step settle; each one is a handful of microtasks deep. */
async function settle(remaining = 10): Promise<void> {
  if (remaining === 0) return;
  await Promise.resolve();
  await settle(remaining - 1);
}

describe("following what is said in the room", () => {
  it("asks for the first page on the interval the module names", async () => {
    const seams = new Seams();
    seams.pages = [pageOf([message(1)])];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();

    expect(seams.milliseconds).toBe(CHAT_POLL_INTERVAL_MILLISECONDS);
    expect(seams.running).toBe(true);
    expect(chat.messages.map((one) => one.id)).toEqual(["meetingMessage_1"]);
    expect(chat.reading).toBe(false);
  });

  it("continues from the cursor the last page answered with, never from a time", async () => {
    const seams = new Seams();
    seams.pages = [pageOf([message(1)]), pageOf([message(2)])];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();
    await seams.fire();

    expect(seams.asked).toEqual([null, "cursor-meetingMessage_1"]);
    expect(chat.messages.map((one) => one.id)).toEqual(["meetingMessage_1", "meetingMessage_2"]);
  });

  it("stays where it is when a page has nothing in it", async () => {
    const seams = new Seams();
    seams.pages = [pageOf([message(1)]), pageOf([]), pageOf([message(2)])];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();
    await seams.fire();
    await seams.fire();

    // A page with no rows carries no cursor, and the one already held is still where to continue.
    expect(seams.asked).toEqual([null, "cursor-meetingMessage_1", "cursor-meetingMessage_1"]);
  });

  it("draws a message once when it arrives by two routes", async () => {
    const seams = new Seams();
    seams.sent = message(2);
    seams.pages = [pageOf([message(1)]), pageOf([message(2)])];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();
    await chat.send("Message 2");
    // The poll that follows reads the row this browser has already been given by the write.
    await seams.fire();

    expect(chat.messages.map((one) => one.id)).toEqual(["meetingMessage_1", "meetingMessage_2"]);
  });

  it("puts what this member said on screen as soon as the record has it", async () => {
    const seams = new Seams();
    seams.sent = message(3);
    seams.pages = [pageOf([])];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();
    const said = await chat.send("  Message 3  ");

    expect(said).toBe(true);
    // Trimmed, because the record is what somebody said and a field's trailing newline is not.
    expect(seams.said).toEqual(["Message 3"]);
    expect(chat.messages.map((one) => one.body)).toEqual(["Message 3"]);
  });

  it("sends nothing at all for an empty field", async () => {
    const seams = new Seams();
    seams.pages = [pageOf([])];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();

    expect(await chat.send("   ")).toBe(false);
    expect(seams.said).toEqual([]);
  });

  it("marks a message taken back rather than taking the row away", async () => {
    const seams = new Seams();
    seams.pages = [pageOf([message(1)])];
    seams.redacted = message(1, { body: "", redactedAt: "2026-09-20T15:10:00.000Z" });
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();
    await chat.redact("meetingMessage_1");

    expect(seams.takenBack).toEqual(["meetingMessage_1"]);
    expect(chat.messages).toHaveLength(1);
    expect(wasTakenBack(chat.messages[0]!)).toBe(true);
    expect(chat.messages[0]?.body).toBe("");
  });

  it("counts what is said while the panel is closed, and nothing that was said before", async () => {
    const seams = new Seams();
    seams.pages = [pageOf([message(1), message(2)]), pageOf([message(3)])];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();
    // The first page is the conversation rather than news: a badge reading forty on arrival is
    // noise, and somebody joining at the twentieth minute did not miss anything.
    expect(chat.unread).toBe(0);

    await seams.fire();
    expect(chat.unread).toBe(1);

    chat.noteOpened();
    expect(chat.unread).toBe(0);
  });

  it("counts nothing while the panel is open, because it is already on screen", async () => {
    const seams = new Seams();
    seams.pages = [pageOf([message(1)]), pageOf([message(2)])];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();
    chat.noteOpened();
    await seams.fire();

    expect(chat.unread).toBe(0);
    expect(chat.messages).toHaveLength(2);
  });

  it("takes a message the room relayed through the same door a page does", async () => {
    const seams = new Seams();
    seams.pages = [pageOf([message(1)])];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();
    chat.noteMessageFrame(message(2));

    expect(chat.messages.map((one) => one.id)).toEqual(["meetingMessage_1", "meetingMessage_2"]);
    expect(chat.unread).toBe(1);
  });

  it("marks a message the ROOM says was taken back, and leaves the row where it was", async () => {
    const seams = new Seams();
    seams.pages = [pageOf([message(1), message(2)])];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();
    chat.noteMessageRedacted("meetingMessage_1", "2026-09-20T15:10:00.000Z");

    // The frame carries the handle and the instant alone — the body is already blank on the
    // record, and sending the words back down the wire to remove them would be absurd.
    expect(chat.messages.map((one) => one.id)).toEqual(["meetingMessage_1", "meetingMessage_2"]);
    expect(wasTakenBack(chat.messages[0]!)).toBe(true);
    expect(chat.messages[0]?.body).toBe("");
    // Not news: a mark inviting somebody to go and read a blank row is a mark that lies.
    expect(chat.unread).toBe(0);
  });

  it("invents no row for a redaction about a message it has never held", () => {
    const seams = new Seams();
    const chat = new MeetingChat(seams);

    chat.noteMessageRedacted("meetingMessage_9", "2026-09-20T15:10:00.000Z");

    // The page that first carries the message will carry it already redacted, so a browser that
    // missed both ends up with the same transcript as one that saw both.
    expect(chat.messages).toEqual([]);
  });

  it("takes a redaction the PAGE reports, for a browser that missed the frame", async () => {
    const seams = new Seams();
    seams.pages = [
      pageOf([message(1), message(2)]),
      // A redaction does not move a row, so a poller walking forward from its cursor would never
      // see it: the page reports what has been taken back BEHIND the reader, by handle and instant.
      pageOf([], [{ id: "meetingMessage_1", redactedAt: "2026-09-20T15:10:00.000Z" }]),
    ];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();
    await seams.fire();

    expect(chat.messages.map((one) => one.id)).toEqual(["meetingMessage_1", "meetingMessage_2"]);
    expect(wasTakenBack(chat.messages[0]!)).toBe(true);
    // The row keeps its place: the redaction changes the body, never the instant it was said at.
    expect(chat.messages[1]?.id).toBe("meetingMessage_2");
    expect(chat.unread).toBe(0);
  });

  it("stretches the poll to its backstop once the room has relayed something", async () => {
    const seams = new Seams();
    seams.pages = [pageOf([message(1)])];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();
    expect(seams.intervals).toEqual([CHAT_POLL_INTERVAL_MILLISECONDS]);

    chat.noteMessageFrame(message(2));

    // The poll is never turned off, only stretched: a frame reaches a socket that has not missed
    // anything, and the read is what catches a browser up on the frames it did not get.
    expect(seams.intervals).toEqual([
      CHAT_POLL_INTERVAL_MILLISECONDS,
      CHAT_BACKSTOP_POLL_INTERVAL_MILLISECONDS,
    ]);
    expect(seams.running).toBe(true);

    // Said once. The second frame changes nothing.
    chat.noteMessageFrame(message(3));
    expect(seams.intervals).toHaveLength(2);
  });

  it("keeps what is on screen when a poll is refused, and says so with nothing to show", async () => {
    const seams = new Seams();
    seams.pages = [pageOf([message(1)])];
    const chat = new MeetingChat(seams);
    chat.start();
    await settle();

    const refused = { problem: null, status: 500 };
    seams.list = () => Promise.resolve({ kind: "failed" as const, failure: refused } as never);
    await seams.fire();

    // A conversation replaced by an error because one poll in twenty failed is a surface that
    // loses a member's place for nothing.
    expect(chat.messages).toHaveLength(1);
    expect(chat.readFailure).not.toBeNull();
  });

  it("lets go of the transcript with the meeting it was about", async () => {
    const seams = new Seams();
    seams.pages = [pageOf([message(1)])];
    const chat = new MeetingChat(seams);

    chat.start();
    await settle();
    chat.stop();

    expect(seams.running).toBe(false);
    expect(chat.messages).toEqual([]);
    expect(chat.unread).toBe(0);
  });
});

describe("the chat panel", () => {
  let target: HTMLElement;
  let instance: Record<string, unknown> | undefined;
  let takenBack: string[] = [];
  let said: string[] = [];

  function panelProps(over: Partial<PanelProps> = {}): PanelProps {
    return {
      open: true,
      messages: [message(1), message(2)],
      unread: 0,
      loading: false,
      failed: false,
      sending: false,
      nameOf: (one) => (one.participantId === "attendance_1" ? "Rosalind Chase" : "Theodore Vance"),
      canTakeBack: () => false,
      onSend: (body: string) => {
        said.push(body);
        return Promise.resolve(true);
      },
      onTakeBack: (messageId: string) => takenBack.push(messageId),
      ...over,
    };
  }

  beforeEach(() => {
    target = document.createElement("div");
    document.body.append(target);
    takenBack = [];
    said = [];
  });

  afterEach(() => {
    if (instance !== undefined) void unmount(instance);
    instance = undefined;
    target.remove();
    for (const panel of document.body.querySelectorAll("[data-bits-floating-content-wrapper]")) {
      panel.remove();
    }
  });

  it("draws a row per message, with who said it and when", () => {
    instance = mount(Panel, { target, props: panelProps() });
    flushSync();

    const shown = document.body.textContent ?? "";
    expect(shown).toContain("Rosalind Chase");
    expect(shown).toContain("Message 1");
    expect(shown).toContain("Theodore Vance");
    expect(shown).toContain("Message 2");
  });

  it("offers Take Back on a row this reader may take back, and on no other", () => {
    instance = mount(Panel, {
      target,
      props: panelProps({ canTakeBack: (one) => one.id === "meetingMessage_1" }),
    });
    flushSync();

    // The control names what it takes back: five rows would otherwise offer five controls all
    // called Take Back.
    const mine = controls().find((control) =>
      control.getAttribute("aria-label")?.startsWith("Take back what Rosalind Chase"),
    );
    expect(mine).toBeDefined();
    expect(
      controls().some((control) =>
        control.getAttribute("aria-label")?.startsWith("Take back what Theodore Vance"),
      ),
    ).toBe(false);

    mine?.click();
    flushSync();
    expect(takenBack).toEqual(["meetingMessage_1"]);
  });

  it("offers Take Back on every row for somebody hosting", () => {
    instance = mount(Panel, { target, props: panelProps({ canTakeBack: () => true }) });
    flushSync();

    const offered = controls().filter((control) =>
      control.getAttribute("aria-label")?.startsWith("Take back what"),
    );
    expect(offered).toHaveLength(2);
  });

  it("says a message was taken back where the words were, and offers nothing on it", () => {
    instance = mount(Panel, {
      target,
      props: panelProps({
        canTakeBack: () => true,
        messages: [message(1, { body: "", redactedAt: "2026-09-20T15:10:00.000Z" })],
      }),
    });
    flushSync();

    expect(document.body.textContent).toContain("Taken back.");
    expect(
      controls().some((control) =>
        control.getAttribute("aria-label")?.startsWith("Take back what"),
      ),
    ).toBe(false);
  });

  it("states an empty transcript inside the record rather than beside it", () => {
    instance = mount(Panel, { target, props: panelProps({ messages: [] }) });
    flushSync();

    expect(document.body.textContent).toContain("Nothing has been said in this meeting yet.");
  });

  it("carries the count of what was said while it was closed", () => {
    instance = mount(Panel, { target, props: panelProps({ open: false, unread: 3 }) });
    flushSync();

    const control = controls().find((one) => one.textContent?.includes("Chat"));
    expect(control?.textContent?.replace(/\s+/gu, " ").trim()).toBe("Chat 3");
  });

  it("wears no count when nothing has been said, rather than a zero", () => {
    instance = mount(Panel, { target, props: panelProps({ open: false }) });
    flushSync();

    const control = controls().find((one) => one.textContent?.includes("Chat"));
    expect(control?.textContent?.replace(/\s+/gu, " ").trim()).toBe("Chat");
  });

  it("says what is typed when Enter is pressed, and writes a line on Shift", async () => {
    instance = mount(Panel, { target, props: panelProps({ draft: "Ready when you are" }) });
    flushSync();

    const field = document.body.querySelector("textarea");
    field?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(said).toEqual(["Ready when you are"]);

    field?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
    );
    await settle();
    expect(said).toEqual(["Ready when you are"]);
  });

  it("says how much room is left only as the ceiling comes into view", () => {
    instance = mount(Panel, { target, props: panelProps({ draft: "Short" }) });
    flushSync();
    expect(document.body.textContent).not.toContain("characters left");

    void unmount(instance);
    instance = mount(Panel, {
      target,
      props: panelProps({ draft: "x".repeat(3_900) }),
    });
    flushSync();
    expect(document.body.textContent).toContain("100 characters left.");
  });

  it("refuses to send a message past the ceiling, and says by how much", () => {
    instance = mount(Panel, { target, props: panelProps({ draft: "x".repeat(4_010) }) });
    flushSync();

    expect(document.body.textContent).toContain("10 characters too many.");
    const send = controls().find((control) => control.textContent?.trim() === "Send");
    expect(send?.disabled).toBe(true);
  });
});
