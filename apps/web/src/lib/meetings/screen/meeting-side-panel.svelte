<script lang="ts" module>
  /** The four tabs. */
  export type MeetingSideTab = "chat" | "questions" | "polls" | "people";

  const SIDE_TABS: readonly string[] = ["chat", "questions", "polls", "people"];

  /** Whether a value the tab list answered is one of the four. */
  export function isMeetingSideTab(value: string): value is MeetingSideTab {
    return SIDE_TABS.includes(value);
  }
</script>

<script lang="ts">
  /*
   * The room's side panel: what people are saying in writing, what they are asking, what they are
   * voting on, and who is here, as four tabs of one panel beside the picture.
   *
   * ONE PANEL, BECAUSE THE FOUR ARE ONE CONVERSATION. Chat, questions and polls are all the room
   * talking without interrupting whoever has the floor, and the people list is who is doing the
   * talking (with their hands up beside their names). Drawn as four dialogs over the picture, each
   * one hid the meeting it was about.
   *
   * The panel draws no content of its own: each tab is the screen's snippet, so the record each one
   * reads (and the failure each one states) stays with the screen that owns it.
   */
  import X from "@lucide/svelte/icons/x";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import type { Snippet } from "svelte";

  let {
    tab = $bindable("chat"),
    chatUnread = 0,
    questionsWaiting = 0,
    pollsWaiting = 0,
    peopleCount = 0,
    onClose,
    chat,
    questions,
    polls,
    people,
  }: {
    /** Which tab is showing. Bindable, so the band's controls and the panel agree. */
    tab?: MeetingSideTab;
    chatUnread?: number;
    questionsWaiting?: number;
    pollsWaiting?: number;
    peopleCount?: number;
    onClose: () => void;
    chat?: Snippet;
    questions?: Snippet;
    polls?: Snippet;
    people: Snippet;
  } = $props();
</script>

{#snippet count(value: number, variant: "primary" | "neutral")}
  {#if value > 0}
    <Badge {variant}>{value}</Badge>
  {/if}
{/snippet}

<aside
  class="flex h-full min-h-0 flex-col gap-12 rounded-lg border border-border-default bg-surface-raised p-12"
  aria-label="Meeting side panel"
>
  <Tabs.Root
    bind:value={() => tab, (next: string) => {
      if (isMeetingSideTab(next)) tab = next;
    }} class="flex min-h-0 flex-1 flex-col gap-12">
    <div class="flex items-center gap-8">
      <Tabs.List class="min-w-0 flex-1">
        {#if chat !== undefined}
          <Tabs.Trigger value="chat">Chat {@render count(chatUnread, "primary")}</Tabs.Trigger>
        {/if}
        {#if questions !== undefined}
          <Tabs.Trigger value="questions">
            Q&amp;A {@render count(questionsWaiting, "primary")}
          </Tabs.Trigger>
        {/if}
        {#if polls !== undefined}
          <Tabs.Trigger value="polls">Polls {@render count(pollsWaiting, "primary")}</Tabs.Trigger>
        {/if}
        <Tabs.Trigger value="people">People {@render count(peopleCount, "neutral")}</Tabs.Trigger>
      </Tabs.List>
      <Button variant="ghost" size="icon-sm" aria-label="Close the side panel" onclick={onClose}>
        <X class="size-16" aria-hidden="true" />
      </Button>
    </div>

    <div class="mc-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
      {#if tab === "chat"}
        {@render chat?.()}
      {:else if tab === "questions"}
        {@render questions?.()}
      {:else if tab === "polls"}
        {@render polls?.()}
      {:else}
        {@render people()}
      {/if}
    </div>
  </Tabs.Root>
</aside>
