<script lang="ts">
  /*
   * The window's right pane: context, in tabs.
   *
   * It is its own part rather than markup inside the shell because it owns the selected tab, and
   * that selection must start fresh every time a window opens — a reader who left one record on its
   * third tab should not land on the third tab of the next one. The window's panel is unmounted
   * while it is closed, so mounting the selection with the pane is what makes each opening honest,
   * with no reset effect to remember to write.
   *
   * Selection starts at `defaultTab` when one is given, which is how a record that arrives with
   * something waiting in a tab can put that tab in front of the reader immediately, and falls back
   * to the first tab otherwise.
   */
  import * as Tabs from "../tabs/index.ts";
  import ScrollEdgeHint from "../scroll-edge-hint/scroll-edge-hint.svelte";
  import { openingTabKey } from "./opening-tab.ts";
  import type { RecordWindowTab } from "./types.ts";

  let {
    tabs,
    defaultTab,
  }: {
    tabs: readonly RecordWindowTab[];
    defaultTab?: string;
  } = $props();

  let chosenTab = $state<string | undefined>(undefined);

  const selectedTab = $derived(chosenTab ?? openingTabKey(tabs, defaultTab));

  /** The strip's own scrollport, watched by the edge hint below it. */
  let tabStrip = $state<HTMLElement | null>(null);
</script>

<Tabs.Root
  class="mc-record-window-tabs"
  bind:value={() => selectedTab, (value) => (chosenTab = value)}
>
  <!-- The strip scrolls sideways past its own tabs, and hides the scrollbar rather than wearing
       one: it is `flex: none`, so a horizontal bar arriving under the labels would push the pane
       below it down by its own height the moment a record gained a tab. The gilt edge rule says
       what the hidden scrollbar no longer can, and is absolutely positioned against this shell,
       which is the strip's own box. -->
  <div class="relative flex min-w-0 flex-none flex-col">
    <Tabs.List bind:ref={tabStrip} class="mc-record-window-tab-strip mc-scrollbar-hidden">
      {#each tabs as tab (tab.key)}
        <Tabs.Trigger value={tab.key}>
          {tab.label}
          {#if tab.count !== undefined}
            <span class="mc-record-window-tab-count">{tab.count}</span>
          {/if}
        </Tabs.Trigger>
      {/each}
    </Tabs.List>
    <ScrollEdgeHint element={tabStrip} axis="inline" />
  </div>
  {#each tabs as tab (tab.key)}
    <Tabs.Content value={tab.key} class="mc-record-window-tab-panel mc-scrollbar">
      {@render tab.content()}
    </Tabs.Content>
  {/each}
</Tabs.Root>
