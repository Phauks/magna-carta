<script lang="ts">
  /*
   * One list of conversations: a row each, the words for an empty list, and the load-more control.
   *
   * The rail draws one of these for every section (Pinned, each folder, General) and one for the
   * whole record while it is searched. Each list is a read of its own in the server's order, so
   * nothing here re-orders or regroups the rows it is handed (docs/conventions/magnus-rulings.md,
   * R1).
   */
  import Button from "@magna-carta/design-system/button";
  import ChoiceRow from "@magna-carta/design-system/choice-row";
  import { instantAttribute } from "@magna-carta/design-system/formatters";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import Pin from "@lucide/svelte/icons/pin";
  import {
    conversationDisplayName,
    conversationStartedLine,
    type MagnusConversation,
  } from "./magnus-api.ts";

  let {
    rows,
    selectedId,
    label,
    matterTitleFor,
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
    /** The matter a row cites beneath its name, or null where it cites none. */
    matterTitleFor?: (matterId: string) => string | null;
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

{#snippet messageGlyph()}
  <MessageSquare aria-hidden="true" />
{/snippet}

{#snippet pinGlyph()}
  <Pin aria-hidden="true" />
{/snippet}

<ul class="flex flex-col gap-4" aria-label={label}>
  {#each rows as conversation (conversation.id)}
    <!-- The line beneath the name carries only what the name does not. An unnamed conversation
         READS as the instant it started, and unnamed is the ordinary case because nothing
         generates a title, so a line restating that instant would be the common row saying one
         fact twice. Where it has nothing to add, the row carries no line at all: absence is the
         signal, and an empty line would be a gap a reader has to wonder about. -->
    {@const startedAt = conversationStartedLine(conversation)}
    {@const matterTitle =
      matterTitleFor !== undefined && conversation.matterId !== null
        ? matterTitleFor(conversation.matterId)
        : null}
    {#snippet rowDetail()}
      {#if startedAt !== null}
        <time datetime={instantAttribute(conversation.createdAt)}>Started {startedAt}</time>
      {/if}
      {#if startedAt !== null && matterTitle !== null}
        <span>&middot;</span>
      {/if}
      {#if matterTitle !== null}
        <span>{matterTitle}</span>
      {/if}
    {/snippet}
    <li>
      <ChoiceRow
        selected={conversation.id === selectedId}
        onclick={() => onSelect(conversation.id)}
        icon={markPinned && conversation.pinnedAt !== null ? pinGlyph : messageGlyph}
        detail={startedAt === null && matterTitle === null ? undefined : rowDetail}
      >
        {conversationDisplayName(conversation)}
      </ChoiceRow>
    </li>
  {/each}
</ul>

{#if rows.length === 0 && emptyLine !== ""}
  <p class="text-sm text-text-muted">{emptyLine}</p>
{/if}

{#if nextCursor !== null && onLoadMore !== undefined}
  <Button variant="ghost" disabled={loadingMore} onclick={onLoadMore}>
    Show more conversations
  </Button>
{/if}
