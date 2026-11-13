<script lang="ts">
  /*
   * One list of conversations: a row each, the words for an empty list, and the load-more control.
   *
   * The rail draws one of these under every heading (Pinned, each folder, each date or matter group)
   * and one for the whole record while it is searched. Each list keeps the server's order, so
   * nothing here re-orders the rows it is handed (docs/conventions/magnus-rulings.md, R1).
   *
   * A row is the owner's board (round 2): the conversation's name over one muted line, the matter's
   * number or General and when it started. The open conversation is marked by a raised ground and
   * a gold edge on the inline start.
   */
  import Button from "@magna-carta/design-system/button";
  import { instantAttribute } from "@magna-carta/design-system/formatters";
  import Pin from "@lucide/svelte/icons/pin";
  import { conversationDisplayName, type MagnusConversation } from "./magnus-api.ts";
  import { railRowLine } from "./magnus-vocabulary.ts";

  let {
    rows,
    selectedId,
    label,
    matterNumberFor,
    now,
    nextCursor = null,
    loadingMore = false,
    emptyLine,
    markPinned = false,
    onSelect,
    onLoadMore,
  }: {
    rows: readonly MagnusConversation[];
    selectedId: string | null;
    /** What the list is, for a screen reader: "Pinned conversations", a folder's name. */
    label: string;
    /** The number of the matter a row is kept on, or null where it is not known. */
    matterNumberFor?: (matterId: string) => string | null;
    /** The day the rail is read on, which decides whether a row shows a time or a date. */
    now: Date;
    nextCursor?: string | null;
    loadingMore?: boolean;
    /** What the list says when it is empty. An empty string says nothing. */
    emptyLine: string;
    /** True where a pinned row should say so (everywhere but the Pinned section itself). */
    markPinned?: boolean;
    onSelect: (conversationId: string) => void;
    onLoadMore?: () => void;
  } = $props();
</script>

<ul class="flex flex-col" aria-label={label}>
  {#each rows as conversation (conversation.id)}
    {@const number =
      conversation.matterId === null
        ? null
        : (matterNumberFor?.(conversation.matterId) ?? "A matter")}
    <li>
      <button
        type="button"
        class="flex w-full min-w-0 flex-col gap-2 rounded-md border-s-2 border-transparent px-12 py-8 text-start hover:bg-surface-sunken aria-[current=true]:border-accent-default aria-[current=true]:bg-surface-selected"
        aria-current={conversation.id === selectedId}
        onclick={() => onSelect(conversation.id)}
      >
        <span class="flex min-w-0 items-center gap-4">
          {#if markPinned && conversation.pinnedAt !== null}
            <Pin class="size-12 shrink-0 text-text-muted" aria-label="Pinned" />
          {/if}
          <span class="truncate text-sm font-medium">{conversationDisplayName(conversation)}</span>
        </span>
        <time
          class="truncate text-xs text-text-muted"
          datetime={instantAttribute(conversation.createdAt)}
        >
          {railRowLine(number, conversation.createdAt, now)}
        </time>
      </button>
    </li>
  {/each}
</ul>

{#if rows.length === 0 && emptyLine !== ""}
  <p class="px-12 py-4 text-sm text-text-muted">{emptyLine}</p>
{/if}

{#if nextCursor !== null && onLoadMore !== undefined}
  <Button variant="ghost" size="sm" disabled={loadingMore} onclick={onLoadMore}>
    Show More Conversations
  </Button>
{/if}
