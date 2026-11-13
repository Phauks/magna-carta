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
   * EACH SECTION IS A CARD THAT FOLDS. A long record ran together when sections were separated by
   * space alone, so each one sits in its own bordered card under a header that carries the
   * section's mark, its name and how many it holds. Pressing the header folds the card to that
   * header, so a reader can put away what they have finished with; jumping to a folded section
   * from the rail opens it again, because a jump is a request to see it.
   *
   * ONE HEIGHT. The region holds the record panel's height (record-panel.ts) and scrolls inside it,
   * so the panel never resizes as sections fill.
   */
  import type { Component, Snippet } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import Badge from "@magna-carta/design-system/badge";
  import Briefcase from "@lucide/svelte/icons/briefcase";
  import Building2 from "@lucide/svelte/icons/building-2";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Copy from "@lucide/svelte/icons/copy";
  import Info from "@lucide/svelte/icons/info";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Network from "@lucide/svelte/icons/network";
  import Phone from "@lucide/svelte/icons/phone";
  import Tag from "@lucide/svelte/icons/tag";
  import User from "@lucide/svelte/icons/user";
  import Users from "@lucide/svelte/icons/users";
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

  /** The mark each kind of section carries in its card header; a section not listed carries none. */
  const MARKS: Readonly<Record<string, Component>> = {
    names: User,
    contact: Phone,
    address: MapPin,
    about: Info,
    identifiers: KeyRound,
    organizations: Building2,
    people: Users,
    relationships: Network,
    duplicates: Copy,
    matters: Briefcase,
    categories: Tag,
  };

  /** The sections the reader has folded away. Every section starts open. */
  const folded = new SvelteSet<string>();

  function toggle(id: string): void {
    if (folded.has(id)) folded.delete(id);
    else folded.add(id);
  }

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
    folded.delete(id);
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
    <div class="flex flex-col gap-16 pb-16">
      {#each sections as entry (entry.id)}
        {@const Mark = MARKS[entry.id]}
        {@const open = !folded.has(entry.id)}
        <section
          id={anchorOf(entry.id)}
          aria-labelledby="{anchorOf(entry.id)}-heading"
          tabindex="-1"
          class="flex flex-col rounded-lg border border-border-default bg-surface-raised outline-none"
        >
          <h3 class="m-0">
            <!-- The whole header is the fold control, so the target is the width of the card. -->
            <button
              type="button"
              class="flex w-full items-center gap-12 rounded-lg px-20 py-12 text-left hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-accent-default"
              aria-expanded={open}
              aria-controls="{anchorOf(entry.id)}-body"
              onclick={() => toggle(entry.id)}
            >
              {#if Mark !== undefined}
                <span
                  class="flex size-32 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-text-muted"
                  aria-hidden="true"
                >
                  <Mark class="size-16" />
                </span>
              {/if}
              <!-- The section is named by its label alone, not by the count and the fold beside it. -->
              <span id="{anchorOf(entry.id)}-heading" class="min-w-0 flex-auto text-md font-semibold">
                {entry.label}
              </span>
              {#if entry.count !== undefined && entry.count !== null && entry.count > 0}
                <Badge variant="neutral">{entry.count}</Badge>
              {/if}
              <ChevronDown
                class="size-16 shrink-0 text-text-muted {open ? '' : '-rotate-90'}"
                aria-hidden="true"
              />
            </button>
          </h3>
          <div
            id="{anchorOf(entry.id)}-body"
            class="flex flex-col gap-16 border-t border-border-default px-20 pt-16 pb-20"
            hidden={!open}
          >
            {@render section(entry)}
          </div>
        </section>
      {/each}
    </div>
  </div>
</div>
