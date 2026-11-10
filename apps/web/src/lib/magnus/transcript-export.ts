/*
 * Downloading a conversation's transcript as a Markdown file.
 *
 * THE WHOLE CONVERSATION, NOT THE PAGES ON SCREEN. The transcript on screen is paged (newest page
 * first, earlier pages on request), so a download built from what happens to be loaded would
 * silently drop the beginning of a long conversation. This reads every page from the server and
 * puts them oldest first, the way a transcript is read.
 *
 * MARKDOWN, because it is plain text a member can open anywhere and it keeps the shape a reader
 * needs: who spoke, when, and their words with their own line breaks. A turn's text is written as
 * it was said, never interpreted: it is the member's question or the model's answer, and both are
 * untrusted text.
 */
import { formatInstant } from "@magna-carta/design-system/formatters";
import type { ApiOutcome } from "$lib/api/request.ts";
import {
  conversationDisplayName,
  readConversation,
  turnFailureSentence,
  type MagnusConversation,
  type MagnusTurn,
} from "./magnus-api.ts";

/**
 * How many pages one download will read before it stops. A page is a server-sized batch of turns,
 * so this bounds a pathological conversation rather than any real one.
 */
const MOST_PAGES = 200;

/** Every turn of the conversation, oldest first. */
export async function readWholeTranscript(
  fetchImpl: typeof fetch,
  conversationId: string,
): Promise<ApiOutcome<readonly MagnusTurn[]>> {
  const outcome = await readPagesFrom(fetchImpl, conversationId, undefined, MOST_PAGES);
  if (outcome.kind !== "ok") return outcome;
  // Each page is newest first and the pages arrive newest first, so the whole is reversed once.
  return { kind: "ok", value: outcome.value.toReversed() };
}

/*
 * One page, then the page its cursor names, until there is none. The reads are one after another
 * by nature: each page's cursor is in the answer to the page before it.
 */
async function readPagesFrom(
  fetchImpl: typeof fetch,
  conversationId: string,
  cursor: string | undefined,
  pagesLeft: number,
): Promise<ApiOutcome<MagnusTurn[]>> {
  const outcome = await readConversation(fetchImpl, conversationId, cursor);
  if (outcome.kind !== "ok") return outcome;
  const here = outcome.value.turns.data;
  const next = outcome.value.turns.nextCursor;
  if (next === null || pagesLeft <= 1) return { kind: "ok", value: here };
  const rest = await readPagesFrom(fetchImpl, conversationId, next, pagesLeft - 1);
  if (rest.kind !== "ok") return rest;
  return { kind: "ok", value: [...here, ...rest.value] };
}

/** The facts the file's heading states. */
export interface TranscriptHeading {
  /** Who asked the questions, by name. */
  memberName: string;
  /** The matter the conversation is kept on, as it reads under the title, or null for none. */
  matterLine: string | null;
  /** When the file was made. */
  downloadedAt: Date;
}

/** The transcript as a Markdown document. */
export function transcriptMarkdown(
  conversation: MagnusConversation,
  turns: readonly MagnusTurn[],
  heading: TranscriptHeading,
): string {
  const lines: string[] = [];
  lines.push(`# ${conversationDisplayName(conversation)}`, "");
  lines.push(`- Matter: ${heading.matterLine ?? "Not kept on a matter"}`);
  lines.push(`- Started: ${formatInstant(conversation.createdAt)}`);
  lines.push(`- Downloaded: ${formatInstant(heading.downloadedAt)}`);
  lines.push("", "A conversation with Magnus, the assistant in Magna Carta. Magnus can be wrong.");
  for (const turn of turns) {
    const speaker = turn.speaker === "member" ? heading.memberName : "Magnus";
    lines.push("", "---", "", `**${speaker}**, ${formatInstant(turn.createdAt)}`, "");
    if (turn.content !== null && turn.content.trim() !== "") lines.push(turn.content);
    const failure = turnFailureSentence(turn);
    if (failure !== null) lines.push(`_No answer: ${failure}_`);
    else if (turn.status === "pending") lines.push("_Magnus had not answered yet._");
    if (turn.contextTruncated) {
      lines.push("", "_This answer was built from part of the conversation._");
    }
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * A file name from the conversation's name: letters, digits, spaces and hyphens kept, everything a
 * file system might refuse dropped, and never empty.
 */
export function transcriptFileName(conversation: MagnusConversation): string {
  const base = conversationDisplayName(conversation)
    .replaceAll(/[^\p{L}\p{N} -]+/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base === "" ? "Magnus conversation" : base}.md`;
}
