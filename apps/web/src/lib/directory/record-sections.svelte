<script lang="ts">
  /*
   * A directory record as one scrolling document: every section stacked, and a rail beside them
   * that jumps to a section and says which one the reader is in.
   *
   * ONE SHAPE FOR ENTERING A PERSON AND FOR READING ONE BACK. The New Person screen and the entity
   * window both compose this, so a record reads the way it was entered. The rail used to swap one
   * section in at a time, which put a person's phone number and address two presses away from the
   * name and left Tab unable to walk the whole record. Now nothing is behind a press: the rail is a
   * table of contents, scrolling is the main way through, and Tab walks every field in order.
   *
   * THE RAIL FOLLOWS THE SCROLL. Which row is lit comes from the scroll position (record-sections.ts),
   * so the rail stays true however the reader moves. A press scrolls to the section, lights its row
   * at once, and holds it while the scroll settles, so the row does not flicker through every
   * section passed on the way. The section takes focus without scrolling again, so a keyboard user
   * continues from where they landed.
   *
   * ONE HEIGHT. The region holds the record panel's height (record-panel.ts) and scrolls inside it,
   * so the panel never resizes as sections fill.
   */
  import type { Snippet } from "svelte";
  import { NavigationLayoutRow } from "@magna-carta/design-system/navigation-layout";
  import { sectionAt, type RecordSection } from "./record-sections.ts";
  import { RECORD_PANEL_BODY_STYLE } from "./record-panel.ts";

  let {
    sections,
    label = "Sections of this record",
    section,
  }: {
    sections: readonly RecordSection[];
    /** The rail's accessible name. */
    label?: string;
    /** One section's body. Its heading is drawn here, from the same label the rail shows. */
    section: Snippet<[RecordSection]>;
  } = $props();

  const identity = $props.id();
  const anchorOf = (id: string): string => `${identity}-${id}`;

  let scroller = $state<HTMLElement | null>(null);
  let current = $state<string | null>(null);
  /** True while a press's scroll is settling; the scroll position does not move the rail meanwhile. */
  let jumping = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;

  const lit = $derived(current ?? sections[0]?.id ?? null);

  function measure(): void {
    frame = 0;
    const region = scroller;
    if (region === null || jumping) return;
    const base = region.getBoundingClientRect().top - region.scrollTop;
    const offsets = sections.flatMap((entry) => {
      const element = document.getElementById(anchorOf(entry.id));
      return element === null ? [] : [{ id: entry.id, top: element.getBoundingClientRect().top - base }];
    });
    current = sectionAt(offsets, {
      top: region.scrollTop,
      viewport: region.clientHeight,
      content: region.scrollHeight,
    });
  }

  function onScroll(): void {
    if (frame === 0) frame = requestAnimationFrame(measure);
  }

  function release(): void {
    jumping = false;
    clearTimeout(releaseTimer);
  }

  function jump(id: string): void {
    const element = document.getElementById(anchorOf(id));
    if (element === null) return;
    current = id;
    jumping = true;
    clearTimeout(releaseTimer);
    // `scrollend` releases the hold where the browser has it; the timer is the backstop.
    releaseTimer = setTimeout(release, 1000);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    element.focus({ preventScroll: true });
  }

  $effect(() => {
    return () => {
      clearTimeout(releaseTimer);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  });
</script>

<div class="flex min-w-0 gap-16" style={RECORD_PANEL_BODY_STYLE} data-record-rail>
  <nav aria-label={label} class="mc-scrollbar flex shrink-0 flex-col gap-4 overflow-y-auto" style="width: 11rem">
    {#each sections as entry (entry.id)}
      <NavigationLayoutRow current={entry.id === lit} onclick={() => jump(entry.id)}>
        {entry.label}
        {#snippet trailing()}
          {#if entry.count !== undefined && entry.count !== null && entry.count > 0}
            <span class="text-xs text-text-subtle tabular-nums">{entry.count}</span>
          {/if}
        {/snippet}
      </NavigationLayoutRow>
    {/each}
  </nav>

  <div
    bind:this={scroller}
    class="mc-scrollbar min-w-0 flex-auto overflow-y-auto"
    onscroll={onScroll}
    onscrollend={release}
  >
    <div class="flex flex-col gap-32 pb-16">
      {#each sections as entry (entry.id)}
        <section
          id={anchorOf(entry.id)}
          aria-labelledby="{anchorOf(entry.id)}-heading"
          tabindex="-1"
          class="flex flex-col gap-16 outline-none"
        >
          <h3 id="{anchorOf(entry.id)}-heading" class="text-sm font-semibold">{entry.label}</h3>
          {@render section(entry)}
        </section>
      {/each}
    </div>
  </div>
</div>
