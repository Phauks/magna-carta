/*
 * Who asked the questions in a conversation, by name.
 *
 * A conversation's questions are its creator's today: the record keeps one author per conversation
 * (`createdBy`), not one per turn. So a member's turn is named after the creator. The signed-in
 * member's own name comes from the session read the app layout already holds; anybody else's comes
 * from the firm roster, which the surfaces share and read once. A name that has not arrived reads as
 * "A Member" rather than as a guess.
 *
 * It is a function that creates reactive state, so it is called while a component initialises
 * (the session read is a query, and a query belongs to the component that made it). The transcript
 * names its turns with it and the surface names the downloaded transcript with it, so the two can
 * never disagree about who asked.
 */
import { createQuery } from "@tanstack/svelte-query";
import { meGetOptions } from "@magna-carta/api-client";
import { SESSION_STABLE } from "$lib/api/screen-data.ts";
import { firmRoster } from "$lib/members/firm-roster.svelte.ts";

/** What a member turn is labelled with until the author's name is known. */
export const UNNAMED_MEMBER = "A Member";

export interface ConversationAuthor {
  /** The name a member turn is labelled with. */
  readonly name: string;
  /** True when the signed-in member started the conversation, so its messages are theirs to change. */
  readonly readerIsAuthor: boolean;
}

/**
 * Track the name of whoever started the conversation `authorId()` returns. Null means no
 * conversation is open yet, which reads as the signed-in member: a fresh conversation is theirs.
 */
export function conversationAuthor(authorId: () => string | null): ConversationAuthor {
  const sessionRead = createQuery(() => ({ ...meGetOptions(), staleTime: SESSION_STABLE }));
  const signedIn = $derived(sessionRead.data ?? null);
  const authorIsReader = $derived.by(() => {
    const id = authorId();
    return id === null || (signedIn !== null && signedIn.user.id === id);
  });

  $effect(() => {
    if (!authorIsReader) void firmRoster.load(fetch);
  });

  const name = $derived.by(() => {
    if (authorIsReader) {
      if (signedIn === null) return UNNAMED_MEMBER;
      const own = signedIn.user.name.trim();
      return own === "" ? signedIn.user.email : own;
    }
    const id = authorId();
    const member = (firmRoster.members ?? []).find((candidate) => candidate.userId === id);
    return member?.displayName ?? UNNAMED_MEMBER;
  });

  return {
    get name() {
      return name;
    },
    get readerIsAuthor() {
      return authorIsReader;
    },
  };
}
