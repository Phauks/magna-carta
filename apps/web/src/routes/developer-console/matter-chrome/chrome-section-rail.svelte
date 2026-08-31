<script lang="ts">
  /*
   * The sections as a vertical rail — the one candidate that does not fold. Every section is
   * present at once, in registry order, so the matter's whole shape is readable without opening a
   * menu and a fifteenth section costs nothing but a row. What it spends is horizontal: the rail
   * sizes to its longest label and takes that width off the work canvas on every section page.
   *
   * The current section is marked at the rail's inner edge (a gold rule against a selected
   * surface) — the same accent the strip's underline carries, turned ninety degrees.
   */
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import { matterSections } from "$lib/matters/sections.ts";

  let {
    activeSlug,
    onSelect,
    maturity = "badge",
    class: className = "",
  }: {
    activeSlug: string;
    onSelect: (slug: string) => void;
    maturity?: "badge" | "none";
    class?: string;
  } = $props();
</script>

<nav aria-label="Matter sections" class="flex flex-col {className}">
  {#each matterSections as section (section.slug)}
    {@const current = section.slug === activeSlug}
    <button
      type="button"
      onclick={() => onSelect(section.slug)}
      aria-current={current ? "page" : undefined}
      class="relative flex cursor-pointer items-center gap-8 rounded-sm py-4 ps-12 pe-8 text-start
             text-sm leading-tight whitespace-nowrap transition-colors duration-fast ease-standard
             {current
        ? 'bg-surface-selected font-semibold text-text-default'
        : 'font-medium text-text-muted hover:text-text-default'}"
    >
      {#if current}
        <span
          class="absolute inset-y-4 start-0 bg-accent-default"
          style="inline-size: var(--mc-focus-ring-width)"
          aria-hidden="true"
        ></span>
      {/if}
      <span class="grow">{section.label}</span>
      {#if maturity === "badge"}
        <MaturityBadge stage={section.stage} />
      {/if}
    </button>
  {/each}
</nav>
