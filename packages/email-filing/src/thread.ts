import type { ParsedMessage } from "@magna-carta/email";
import type { EmailThreadId } from "@magna-carta/identifiers/types";

// Resolve a Message-ID value to the thread it already belongs to, or undefined if unseen. The caller
// backs this with a per-firm lookup over captured messages (In-Reply-To / References resolution).
export type ThreadLookup = (messageIdValue: string) => EmailThreadId | undefined;

export interface ThreadLinkDecision {
  readonly threadId: EmailThreadId;
  readonly isNewThread: boolean;
  // The immediate parent this message claims (In-Reply-To, else the nearest References entry), whether
  // or not it is itself captured yet — recorded so a late-arriving parent can be reconciled later.
  readonly parentMessageId: string | null;
}

// Link a message into a thread DAG. A conversation is a DAG, not a line: a reply can reference several
// ancestors, and forks and late-surfacing messages are edges. If any claimed ancestor is already in a
// thread, this message joins that thread; otherwise it opens a new one under `newThreadId`. Pure — the
// caller mints the candidate id and supplies the lookup.
export function linkThread(
  message: ParsedMessage,
  lookup: ThreadLookup,
  newThreadId: EmailThreadId,
): ThreadLinkDecision {
  const parents = candidateParents(message);
  for (const parent of parents) {
    const existing = lookup(parent);
    if (existing !== undefined) {
      return { threadId: existing, isNewThread: false, parentMessageId: parents[0] ?? null };
    }
  }
  return { threadId: newThreadId, isNewThread: true, parentMessageId: parents[0] ?? null };
}

// The claimed ancestors, nearest first: In-Reply-To, then References newest→oldest (RFC 5322 orders
// References oldest→newest, so the nearest ancestor is its last entry). Deduplicated, order preserved.
export function candidateParents(message: ParsedMessage): string[] {
  const parents: string[] = [];
  if (message.inReplyTo !== null) parents.push(message.inReplyTo);
  for (let index = message.references.length - 1; index >= 0; index -= 1) {
    const reference = message.references[index];
    if (reference !== undefined && !parents.includes(reference)) parents.push(reference);
  }
  return parents;
}

// A subject reduced to its conversation stem: reply/forward prefixes stripped, whitespace collapsed,
// lowercased — the coarse fallback grouping when a message shares no Message-ID with its thread.
export function normalizeSubject(subject: string | null): string | null {
  if (subject === null) return null;
  const stripped = subject.replace(/^(?:\s*(?:re|fwd|fw|aw|wg)\s*:\s*)+/iu, "");
  const collapsed = stripped.replace(/\s+/gu, " ").trim().toLowerCase();
  return collapsed.length > 0 ? collapsed : null;
}
