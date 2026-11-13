import {
  ATTACHMENT_TEXT_MAX_BYTES,
  EARLIER_CONVERSATIONS_MAX_BYTES,
  contentByteLength,
  cutToByteLength,
} from "./limits.ts";
import type { TurnRow } from "./types.ts";

// The bounded conversation window: what the consumer actually sends to the model.
//
// Unbounded history is the classic cost failure — turn 40 re-sending turns 1 through 39 grows a
// conversation's cost quadratically — but it is a confidentiality fact before it is a cost one: every
// re-send is another transmission of the same privileged content. So the bound is a rule, not a
// tuning parameter.
//
// The rule: at most the last 20 turns and at most 128 KiB of total content, whichever binds first,
// always ending on the member's newest turn. When it truncates, the caller is told, and the answer
// says so — silent truncation is the version of this that produces a confidently wrong answer built
// on a premise the member believes was in scope.

export const WINDOW_MAX_TURNS = 20;
export const WINDOW_MAX_BYTES = 131072;

// A window message in the platform's own vocabulary. It maps onto the inference port's conversation
// roles at the call site; nothing here names a vendor's role.
export interface WindowMessage {
  readonly role: "member" | "assistant";
  readonly content: string;
}

// The readable text of one attached file, as the caller extracted it, with the name the member knows
// it by. The text is placed ahead of the member's newest question under a heading naming the file, so
// the model reads the document the way the member did: before the question about it.
export interface WindowAttachment {
  readonly fileId: string;
  readonly name: string;
  readonly text: string;
}

// How much of each attachment reached the request: the whole text, a cut prefix of it, or none
// because the budget was already spent by the attachments before it. Reported so the surface can say
// so, per file, rather than the member wondering whether the model saw the document.
export interface WindowAttachmentOutcome {
  readonly fileId: string;
  readonly sent: "whole" | "cut" | "none";
  readonly bytes: number;
}

export interface ConversationWindow {
  readonly messages: readonly WindowMessage[];
  // True when at least one turn that had content was left out of the window — either because a cap
  // dropped it, or because the caller's own read of the conversation was itself bounded.
  readonly truncated: boolean;
  // One outcome per attachment handed in, in the same order.
  readonly attachments: readonly WindowAttachmentOutcome[];
}

// The heading each attachment's text sits under, and the line that marks a cut. Both are platform
// text the model is told to expect (system-prompt.ts), never something a member wrote.
function attachmentHeading(name: string): string {
  return `--- Attached file: ${name} ---`;
}
const ATTACHMENT_CUT_MARK = "[The rest of this file did not fit and was not sent.]";

// Lays the attachments out under one byte budget, in order, and says what each got. A file whose
// whole text fits goes in whole; the first that does not is cut to what is left and marked; every
// file after that gets nothing, because a heading over no text would tell the model a document was
// there when it was not.
function layOutAttachments(attachments: readonly WindowAttachment[]): {
  readonly preface: string;
  readonly outcomes: readonly WindowAttachmentOutcome[];
} {
  const parts: string[] = [];
  const outcomes: WindowAttachmentOutcome[] = [];
  let remaining = ATTACHMENT_TEXT_MAX_BYTES;
  for (const attachment of attachments) {
    const text = attachment.text.trim();
    const bytes = contentByteLength(text);
    if (remaining <= 0 || text === "") {
      outcomes.push({ fileId: attachment.fileId, sent: "none", bytes: 0 });
      continue;
    }
    if (bytes <= remaining) {
      parts.push(`${attachmentHeading(attachment.name)}\n${text}`);
      outcomes.push({ fileId: attachment.fileId, sent: "whole", bytes });
      remaining -= bytes;
      continue;
    }
    const cut = cutToByteLength(text, remaining);
    const cutBytes = contentByteLength(cut);
    parts.push(`${attachmentHeading(attachment.name)}\n${cut}\n${ATTACHMENT_CUT_MARK}`);
    outcomes.push({ fileId: attachment.fileId, sent: "cut", bytes: cutBytes });
    remaining = 0;
  }
  return { preface: parts.join("\n\n"), outcomes };
}

// One of the author's own earlier conversations on the matter, already read by the caller: its name
// and its turns, oldest first.
export interface WindowEarlierConversation {
  readonly title: string | null;
  readonly turns: readonly TurnRow[];
}

function earlierConversationHeading(title: string | null): string {
  return `--- Your earlier conversation on this matter: ${title ?? "Untitled"} ---`;
}
const EARLIER_CONVERSATION_CUT_MARK =
  "[The rest of this conversation did not fit and was not sent.]";

// Lays the earlier conversations out under their own budget, most recent first, each as the turns
// the model may read ("Member:" and "Magnus:" lines). The first that does not fit is cut and marked,
// and the rest are left out, for the same reason a file after the budget is: a heading over nothing
// would say a conversation was there when it was not.
function layOutEarlierConversations(conversations: readonly WindowEarlierConversation[]): string {
  const parts: string[] = [];
  let remaining = EARLIER_CONVERSATIONS_MAX_BYTES;
  for (const conversation of conversations) {
    if (remaining <= 0) break;
    const lines = [...conversation.turns]
      .sort((left, right) => left.sequence - right.sequence)
      .filter(hasContent)
      .map((turn) => `${turn.speaker === "member" ? "Member" : "Magnus"}: ${turn.content}`);
    const text = lines.join("\n\n").trim();
    if (text === "") continue;
    const bytes = contentByteLength(text);
    if (bytes <= remaining) {
      parts.push(`${earlierConversationHeading(conversation.title)}\n${text}`);
      remaining -= bytes;
      continue;
    }
    const cut = cutToByteLength(text, remaining);
    parts.push(
      `${earlierConversationHeading(conversation.title)}\n${cut}\n${EARLIER_CONVERSATION_CUT_MARK}`,
    );
    remaining = 0;
  }
  return parts.join("\n\n");
}

// Turns with no content are skipped, not counted: a pending or failed Magnus turn has nothing to say
// to the model, and counting it against the window would silently shrink the real history.
// A turn the model may read: it has words, and its author has neither removed it nor set it aside by
// editing an earlier message. Removed and superseded turns stay on the record for the reader's
// history and the firm's, but an answer is never built on a message its author took back.
function hasContent(turn: TurnRow): turn is TurnRow & { readonly content: string } {
  return (
    turn.content !== null &&
    turn.content !== "" &&
    turn.removedAt === null &&
    turn.supersededAt === null
  );
}

export interface ConversationWindowOptions {
  // True when the caller's own read of the conversation hit ITS limit, so turns older than the ones
  // handed in certainly exist. Without it a window that fits its caps exactly is indistinguishable
  // from one built on a bounded read that happened to fill up — and the difference is precisely what
  // the member is being told, so it cannot be inferred from the rows alone.
  readonly readWasCapped?: boolean;
  // The readable text of the conversation's attachments, already extracted by the caller. Placed
  // ahead of the newest member turn under their own budget (ATTACHMENT_TEXT_MAX_BYTES), inside the
  // window's own cap. Absent or empty means the question travels as typed.
  readonly attachments?: readonly WindowAttachment[];
  // The author's own earlier conversations on the matter, when the author turned that permission on
  // for this conversation (permissions.ts). Placed ahead of the files under their own budget
  // (EARLIER_CONVERSATIONS_MAX_BYTES). Absent or empty means none are sent.
  readonly earlierConversations?: readonly WindowEarlierConversation[];
  // The documents Magnus has written in this conversation, each at its latest version, laid out by
  // the caller (artifact.ts) under their own budget. Placed first, so Magnus revises a document from
  // what it is now. Absent or empty means there are none.
  readonly documents?: string;
}

// Builds the window from the conversation's turns in ascending sequence order. Walks BACKWARD from
// the newest so the caps drop the oldest turns rather than the most relevant ones, then restores
// ascending order for the request.
export function buildConversationWindow(
  turns: readonly TurnRow[],
  options: ConversationWindowOptions = {},
): ConversationWindow {
  const ordered = [...turns].sort((left, right) => left.sequence - right.sequence);
  const eligible = ordered.filter(hasContent);

  // The window must end on the member's newest turn — the question being answered. Anything after it
  // (an already-answered Magnus turn from a redelivery, say) is not part of this request.
  let lastMemberIndex = -1;
  for (let index = eligible.length - 1; index >= 0; index--) {
    const turn = eligible[index];
    if (turn !== undefined && turn.speaker === "member") {
      lastMemberIndex = index;
      break;
    }
  }
  const readWasCapped = options.readWasCapped === true;
  const laidOutFiles = layOutAttachments(options.attachments ?? []);
  const earlier = layOutEarlierConversations(options.earlierConversations ?? []);
  const laidOut = {
    preface: [options.documents ?? "", earlier, laidOutFiles.preface]
      .filter((part) => part !== "")
      .join("\n\n"),
    outcomes: laidOutFiles.outcomes,
  };
  if (lastMemberIndex === -1) {
    return {
      messages: [],
      truncated: readWasCapped || eligible.length > 0,
      attachments: laidOut.outcomes.map((outcome) => ({ ...outcome, sent: "none", bytes: 0 })),
    };
  }

  const candidates = eligible.slice(0, lastMemberIndex + 1);

  const selected: WindowMessage[] = [];
  let bytes = 0;
  for (let index = candidates.length - 1; index >= 0; index--) {
    const turn = candidates[index];
    if (turn === undefined) continue;
    if (selected.length >= WINDOW_MAX_TURNS) break;
    // The attachments ride the newest member turn — the question they were attached beside — and
    // count against the window with it. Every earlier turn travels as it was typed.
    const content =
      selected.length === 0 && laidOut.preface !== ""
        ? `${laidOut.preface}\n\n${turn.content}`
        : turn.content;
    const turnBytes = contentByteLength(content);
    // The newest member turn always goes in even when it alone exceeds the byte cap: dropping the
    // question would send the model a conversation with no question in it. The per-turn cap in
    // limits.ts and the attachment budget above are what keep that case bounded.
    if (selected.length > 0 && bytes + turnBytes > WINDOW_MAX_BYTES) break;
    bytes += turnBytes;
    selected.push({ role: turn.speaker === "member" ? "member" : "assistant", content });
  }
  selected.reverse();

  return {
    messages: selected,
    truncated: readWasCapped || selected.length < eligible.length,
    attachments: laidOut.outcomes,
  };
}
