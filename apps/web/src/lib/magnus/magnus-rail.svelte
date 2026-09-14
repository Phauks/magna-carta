<script lang="ts">
  /*
   * The rail: every conversation the surface lists, one row each, in the order the reader chose.
   *
   * THE ORDER IS THE SERVER'S. The control at the head asks the listing for the order, and the rail
   * draws what comes back; it never re-orders the page it holds, because an order applied to what
   * happens to be loaded is not the order (docs/conventions/magnus-rulings.md, R1). The control is
   * there in the empty state too: a rail with nothing in it still shows how it would be ordered
   * rather than conjuring the control with the first conversation (R2).
   *
   * The rail owns no frame. The surface around it decides whether it stands as a column or sits
   * under a switcher, and the column frame is one swap point there; this component is the rows, the
   * order control, the load-more control, and the words for an empty record.
   */
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import ChoiceRow from "@magna-carta/design-system/choice-row";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { instantAttribute } from "@magna-carta/design-system/formatters";
  import ArrowUpDown from "@lucide/svelte/icons/arrow-up-down";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import {
    conversationDisplayName,
    conversationStartedLine,
    type ConversationSort,
    type MagnusConversation,
  } from "./magnus-api.ts";
  import {
    CONVERSATION_SORT_LABELS,
    offeredSorts,
    sortControlLabel,
  } from "./magnus-vocabulary.ts";

  let {
    rows,
    selectedId,
    sort = $bindable("date"),
    onMatter = false,
    matterTitleFor,
    nextCursor = null,
    loadingMore = false,
    emptyLine,
    onSelect,
    onSortChange,
    onLoadMore,
  }: {
    /** The rows to draw. An empty list is the empty record; the loading state is the surface's. */
    rows: readonly MagnusConversation[];
    selectedId: string | null;
    /** The order the rows are in. Bindable, and every change is a fresh read at the caller. */
    sort?: ConversationSort;
    /** True inside a matter, where ordering by matter would order by nothing. */
    onMatter?: boolean;
    /** The matter a row cites beneath its name, or null where it cites none. */
    matterTitleFor?: (matterId: string) => string | null;
    nextCursor?: string | null;
    loadingMore?: boolean;
    /** What the rail says when the record is empty. */
    emptyLine: string;
    onSelect: (conversationId: string) => void;
    onSortChange: (sort: ConversationSort) => void;
    onLoadMore?: () => void;
  } = $props();

  const sorts = $derived(offeredSorts({ onMatter }));

  function chooseSort(value: string): void {
    const chosen = sorts.find((candidate) => candidate === value);
    if (chosen === undefined || chosen === sort) return;
    sort = chosen;
    onSortChange(chosen);
  }
</script>

{#snippet messageGlyph()}
  <MessageSquare aria-hidden="true" />
{/snippet}

<div class="flex flex-col gap-8">
  <!-- The order control leads the rail and never leaves it. A menu rather than a row of buttons:
       three words on one control cost one line, and the chosen one reads on the control itself. -->
  <div class="flex items-center justify-between gap-8">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonClasses({ variant: "ghost", size: "sm" })}
        aria-label={sortControlLabel(sort)}
      >
        <ArrowUpDown class="size-16" aria-hidden="true" />
        {sortControlLabel(sort)}
        <ChevronDown class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" style="min-inline-size: var(--mc-size-popover)">
        <DropdownMenu.RadioGroup value={sort} onValueChange={chooseSort}>
          {#each sorts as candidate (candidate)}
            <DropdownMenu.RadioItem value={candidate}>
              {CONVERSATION_SORT_LABELS[candidate]}
            </DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>

  <ul class="flex flex-col gap-4" aria-label="Your conversations with Magnus">
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
          icon={messageGlyph}
          detail={startedAt === null && matterTitle === null ? undefined : rowDetail}
        >
          {conversationDisplayName(conversation)}
        </ChoiceRow>
      </li>
    {/each}
  </ul>

  {#if rows.length === 0}
    <p class="text-sm text-text-muted">{emptyLine}</p>
  {/if}

  {#if nextCursor !== null && onLoadMore !== undefined}
    <Button variant="ghost" disabled={loadingMore} onclick={onLoadMore}>
      Show more conversations
    </Button>
  {/if}
</div>
