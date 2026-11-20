<script lang="ts" module>
  /** The tabs. Security is drawn only in an end-to-end encrypted meeting. */
  export type MeetingSideTab = "chat" | "questions" | "polls" | "people" | "security";

  const SIDE_TABS: readonly string[] = ["chat", "questions", "polls", "people", "security"];

  /** Whether a value the tab list answered is one of the tabs. */
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
   * SECURITY IS A TAB OF THE SAME PANEL in an end-to-end encrypted meeting: the code two people
   * read aloud to each other is read while the meeting stays in view, one tab away. Its trigger
   * carries the shield the header's mark wears, so the two read as one fact.
   *
   * The panel draws no content of its own: each tab is the screen's snippet, so the record each one
   * reads (and the failure each one states) stays with the screen that owns it.
   */
  import MessageCircleQuestionMark from "@lucide/svelte/icons/message-circle-question-mark";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import ShieldOff from "@lucide/svelte/icons/shield-off";
  import X from "@lucide/svelte/icons/x";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import ScrollEdgeHint from "@magna-carta/design-system/scroll-edge-hint";
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
    security,
    securityPaused = false,
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
    /** The Security tab, drawn only where the meeting is encrypted end to end. */
    security?: Snippet;
    /** Whether the key group says encryption is paused, which the tab's shield shows. */
    securityPaused?: boolean;
  } = $props();

  /** The tab strip's own element, which the edge hint watches. */
  let tabStrip = $state<HTMLElement | null>(null);

  /* The tab showing is never the one scrolled out of sight, whichever control opened it. */
  $effect(() => {
    void tab;
    tabStrip
      ?.querySelector('[data-state="active"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
</script>

{#snippet count(value: number, variant: "primary" | "neutral")}
  {#if value > 0}
    <Badge {variant}>{value}</Badge>
  {/if}
{/snippet}

<aside
  class="flex h-full min-h-0 flex-col gap-12 rounded-lg border border-border-strong bg-surface-raised p-12 shadow-elevation"
  aria-label="Meeting side panel"
>
  <Tabs.Root
    bind:value={() => tab, (next: string) => {
      if (isMeetingSideTab(next)) tab = next;
    }} class="flex min-h-0 flex-1 flex-col gap-12">
    <div class="flex items-center gap-8">
      <!-- The strip scrolls sideways where the panel is too narrow for every tab, with no scrollbar
           to reflow it and a rule at the edge saying there is more. -->
      <div class="relative flex min-w-0 flex-1 flex-col">
      <Tabs.List
        bind:ref={tabStrip}
        class="mc-scrollbar-hidden min-w-0 overflow-x-auto *:shrink-0 *:whitespace-nowrap"
      >
        {#if chat !== undefined}
          <Tabs.Trigger value="chat">
            Chat {@render count(chatUnread, "primary")}
            {#if questions === undefined && questionsWaiting > 0}
              <!-- Questions are part of the chat; the ones still waiting are counted beside it. -->
              <Badge variant="neutral" aria-label="{questionsWaiting} questions waiting">
                <MessageCircleQuestionMark class="size-12" aria-hidden="true" />
                {questionsWaiting}
              </Badge>
            {/if}
          </Tabs.Trigger>
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
        {#if security !== undefined}
          <Tabs.Trigger value="security" class="gap-4">
            {#if securityPaused}
              <ShieldOff class="size-16" aria-hidden="true" />
            {:else}
              <ShieldCheck class="size-16" aria-hidden="true" />
            {/if}
            Security
          </Tabs.Trigger>
        {/if}
      </Tabs.List>
      <ScrollEdgeHint element={tabStrip} axis="inline" />
      </div>
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
      {:else if tab === "security"}
        {@render security?.()}
      {:else}
        {@render people()}
      {/if}
    </div>
  </Tabs.Root>
</aside>
