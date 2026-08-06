import { contentByteLength } from "./limits.ts";
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

export interface ConversationWindow {
  readonly messages: readonly WindowMessage[];
  // True when at least one turn that had content was left out of the window — either because a cap
  // dropped it, or because the caller's own read of the conversation was itself bounded.
  readonly truncated: boolean;
}

// Turns with no content are skipped, not counted: a pending or failed Magnus turn has nothing to say
// to the model, and counting it against the window would silently shrink the real history.
function hasContent(turn: TurnRow): turn is TurnRow & { readonly content: string } {
  return turn.content !== null && turn.content !== "";
}

export interface ConversationWindowOptions {
  // True when the caller's own read of the conversation hit ITS limit, so turns older than the ones
  // handed in certainly exist. Without it a window that fits its caps exactly is indistinguishable
  // from one built on a bounded read that happened to fill up — and the difference is precisely what
  // the member is being told, so it cannot be inferred from the rows alone.
  readonly readWasCapped?: boolean;
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
  if (lastMemberIndex === -1) {
    return { messages: [], truncated: readWasCapped || eligible.length > 0 };
  }

  const candidates = eligible.slice(0, lastMemberIndex + 1);

  const selected: WindowMessage[] = [];
  let bytes = 0;
  for (let index = candidates.length - 1; index >= 0; index--) {
    const turn = candidates[index];
    if (turn === undefined) continue;
    if (selected.length >= WINDOW_MAX_TURNS) break;
    const turnBytes = contentByteLength(turn.content);
    // The newest member turn always goes in even when it alone exceeds the byte cap: dropping the
    // question would send the model a conversation with no question in it. The per-turn cap in
    // limits.ts is what keeps that case bounded.
    if (selected.length > 0 && bytes + turnBytes > WINDOW_MAX_BYTES) break;
    bytes += turnBytes;
    selected.push({
      role: turn.speaker === "member" ? "member" : "assistant",
      content: turn.content,
    });
  }
  selected.reverse();

  return { messages: selected, truncated: readWasCapped || selected.length < eligible.length };
}
