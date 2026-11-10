/*
 * The address of one Magnus conversation.
 *
 * A conversation is opened in the workspace (or a matter's Magnus section) by its id in the query
 * string, `?conversation=<id>`, on whichever page it is being read from. The page stays the same
 * page: the parameter only says which conversation it opens with, which is why a copied link from a
 * matter's section reopens it in that section and one from the workspace reopens it there.
 */

/** The query-string key that names the open conversation. */
export const CONVERSATION_PARAMETER = "conversation";

/** The link to `conversationId` on the page at `here`, with every other parameter kept. */
export function conversationLink(here: URL, conversationId: string): URL {
  const link = new URL(here.href);
  link.searchParams.set(CONVERSATION_PARAMETER, conversationId);
  link.hash = "";
  return link;
}

/** The conversation the address names, or null when it names none. */
export function conversationFromAddress(here: URL): string | null {
  const named = here.searchParams.get(CONVERSATION_PARAMETER)?.trim() ?? "";
  return named === "" ? null : named;
}
