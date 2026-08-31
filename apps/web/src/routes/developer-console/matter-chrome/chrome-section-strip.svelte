<script lang="ts">
  /*
   * The section strip, with its placement left to the caller — the one piece every horizontal
   * candidate on this page shares. It exists so five arrangements are five arrangements and not
   * five strips: the fold arithmetic comes from the same model the shipped nav uses
   * ($lib/matters/section-overflow.svelte.ts), so a candidate cannot fold its tabs by a different
   * rule than the product does.
   *
   * What a candidate varies: density, which end the row is packed to, whether maturity reads as a
   * labelled badge, a dot, or nothing at all, and how the current section is marked. A strip flush against a rule
   * takes the underline; a strip floating on a header row takes the pill, because a gold bar with
   * no track beneath it marks nothing.
   *
   * Selecting a section here changes THIS PAGE's current section rather than navigating: the whole
   * point is to see the mark move through an arrangement without leaving the comparison. The
   * shipped strip renders real anchors — see matter-section-nav.svelte.
   */
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import MaturityDot from "$lib/maturity/maturity-dot.svelte";
  import { SectionOverflow } from "$lib/matters/section-overflow.svelte.ts";
  import { matterSections } from "$lib/matters/sections.ts";

  let {
    activeSlug,
    onSelect,
    density = "comfortable",
    align = "start",
    maturity = "badge",
    mark = "underline",
    class: className = "",
  }: {
    activeSlug: string;
    onSelect: (slug: string) => void;
    density?: "comfortable" | "compact";
    align?: "start" | "end";
    maturity?: "badge" | "dot" | "none";
    mark?: "underline" | "pill";
    class?: string;
  } = $props();

  const overflow = new SectionOverflow(() => matterSections.length);

  const visibleSections = $derived(matterSections.slice(0, overflow.visibleCount));
  const overflowSections = $derived(matterSections.slice(overflow.visibleCount));
  const activeInOverflow = $derived(
    overflowSections.some((section) => section.slug === activeSlug),
  );

  /* No row gap, deliberately: the measured widths sum exactly to the row only while the spacing
     lives inside each tab. The pill mark is safe under that rule because one section is current
     at a time, so two pills are never adjacent. */
  const tabClasses = $derived(
    "relative inline-flex items-center whitespace-nowrap transition-colors duration-fast " +
      "ease-standard text-sm leading-tight cursor-pointer " +
      (density === "compact" ? "gap-4 px-8 py-4" : "gap-8 px-12 py-8"),
  );
  const tabInactiveClasses = "font-medium text-text-muted hover:text-text-default";
  const tabActiveClasses = $derived(
    mark === "pill"
      ? "font-semibold text-text-default rounded-md bg-surface-selected"
      : "font-semibold text-text-default",
  );
</script>

<nav aria-label="Matter sections" class="relative {className}">
  <div
    class="flex items-center {align === 'end' ? 'justify-end' : ''}"
    bind:clientWidth={overflow.containerWidth}
  >
    {#each visibleSections as section (section.slug)}
      {@const current = section.slug === activeSlug}
      <button
        type="button"
        onclick={() => onSelect(section.slug)}
        aria-current={current ? "page" : undefined}
        class="{tabClasses} {current ? tabActiveClasses : tabInactiveClasses}"
      >
        {section.label}
        {#if maturity === "badge"}
          <MaturityBadge stage={section.stage} />
        {:else if maturity === "dot"}
          <MaturityDot stage={section.stage} />
        {/if}
        {#if current && mark === "underline"}
          <!-- The gold bar over the track — the active mark of the tabs register. -->
          <span
            class="absolute inset-x-12 bottom-0 bg-accent-default"
            style="block-size: var(--mc-focus-ring-width)"
            aria-hidden="true"
          ></span>
        {/if}
      </button>
    {/each}
    {#if overflowSections.length > 0}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="{tabClasses} {activeInOverflow ? tabActiveClasses : tabInactiveClasses}"
        >
          More
          <ChevronDown class="size-16" aria-hidden="true" />
          {#if activeInOverflow && mark === "underline"}
            <span
              class="absolute inset-x-12 bottom-0 bg-accent-default"
              style="block-size: var(--mc-focus-ring-width)"
              aria-hidden="true"
            ></span>
          {/if}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
          {#each overflowSections as section (section.slug)}
            {@const current = section.slug === activeSlug}
            <DropdownMenu.Item
              onSelect={() => onSelect(section.slug)}
              aria-current={current ? "page" : undefined}
              class={current ? "font-semibold" : undefined}
            >
              {section.label}
              <MaturityBadge stage={section.stage} class="ms-auto" />
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>

  <!-- The measuring mirror: every tab plus the More trigger, rendered at the active weight and
       with the same maturity mark the row carries, but invisible, inert and out of flow. -->
  <div
    class="pointer-events-none invisible absolute inset-x-0 top-0 flex items-center overflow-hidden"
    aria-hidden="true"
  >
    {#each matterSections as section, index (section.slug)}
      <span class="{tabClasses} {tabActiveClasses}" bind:clientWidth={overflow.itemWidths[index]}>
        {section.label}
        {#if maturity === "badge"}
          <MaturityBadge stage={section.stage} />
        {:else if maturity === "dot"}
          <MaturityDot stage={section.stage} />
        {/if}
      </span>
    {/each}
    <span class="{tabClasses} {tabActiveClasses}" bind:clientWidth={overflow.moreTriggerWidth}>
      More
      <ChevronDown class="size-16" aria-hidden="true" />
    </span>
  </div>
</nav>
