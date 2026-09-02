<script lang="ts">
  /*
   * The matter's section strip — route-driven navigation styled in the tabs register. The design
   * system's Tabs is Bits UI's state-based ARIA tablist, the wrong semantics for links that
   * change the address, so this strip renders real anchors inside a nav landmark and speaks the
   * Tabs recipe's visual language through tokens (quiet triggers, the gold bar under the active
   * section). No tablist ARIA is faked onto the links; the current section is stated with
   * aria-current="page". One identical strip for every matter status — status never gates
   * navigation.
   *
   * IT DRAWS NO RULE OF ITS OWN. The strip sits in the inline-end column of the matter's header
   * band (matter-header.svelte), flush against the band's bottom border, and packed to the end of
   * that column. The band owns the rule; the gold active bar lands on it. A border here would
   * draw a second line a few pixels above the first.
   *
   * THE ROW IS THE STRIP'S TOP LEVEL, NOT ITS SECTION LIST. Fourteen sections fit no canvas, so
   * the arrangement in sections.ts puts most of them in named groups — Money, Record, People —
   * and the row carries six entries: four sections and the group triggers. A group whose section
   * is the current one wears the gold bar itself, so the strip always says where the reader is
   * even when the destination is a menu away. The reasoning for the grouping lives with the
   * arrangement, in sections.ts.
   *
   * THE MEASURED FOLD IS NOW A BACKSTOP, NOT THE MECHANISM. It stays because a canvas can always
   * be narrower than six entries — an invisible mirror of the row reports each entry's width
   * (bind:clientWidth), and trailing entries fold into More as the column narrows. At desk width
   * with six entries it does not fire. The arithmetic and the two rules it has to keep live in
   * section-overflow.svelte.ts. A GROUP that folds keeps its name inside More, as a menu group
   * heading over its own sections — a folded group must not decant into a flat list, or the two
   * ways of reaching a section disagree about what it belongs to.
   *
   * THE STRIP CARRIES NO MATURITY BADGES. A tab names a place; how far along that place is belongs
   * to the place itself, where a reader is already looking at it. Eleven pillboxes strung across
   * one row read as chrome, crowded out the labels they were attached to, and made the strip about
   * the build rather than about the matter. The measuring mirror drops them too — it exists to
   * report what the strip actually draws, and a mirror wider than the strip folds tabs that fit.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { SectionOverflow } from "$lib/matters/section-overflow.svelte.ts";
  import { matterStrip, type MatterSection, type MatterStripEntry } from "$lib/matters/sections.ts";

  let { matterId }: { matterId: string } = $props();

  function sectionHref(section: MatterSection): string {
    return `/matters/${matterId}/${section.slug}`;
  }

  function isCurrentSection(section: MatterSection, pathname: string): boolean {
    const href = sectionHref(section);
    if (section.slug === "overview") {
      // Overview owns /overview and the bare matter root, which redirects to it; every deeper
      // path belongs to a named section.
      const root = `/matters/${matterId}`;
      return pathname === href || pathname === root || pathname === `${root}/`;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  /** True when the reader is anywhere under this entry — the section itself, or one in its group. */
  function isCurrentEntry(entry: MatterStripEntry, pathname: string): boolean {
    return entry.kind === "section"
      ? isCurrentSection(entry.section, pathname)
      : entry.sections.some((section) => isCurrentSection(section, pathname));
  }

  /** Stable key: a group is named, a lone section is its slug, and the two can never collide. */
  function entryKey(entry: MatterStripEntry): string {
    return entry.kind === "section" ? `section:${entry.section.slug}` : `group:${entry.label}`;
  }

  const overflow = new SectionOverflow(() => matterStrip.length);

  const visibleEntries = $derived(matterStrip.slice(0, overflow.visibleCount));
  const foldedEntries = $derived(matterStrip.slice(overflow.visibleCount));
  const activeInFold = $derived(
    foldedEntries.some((entry) => isCurrentEntry(entry, page.url.pathname)),
  );

  // The shared tab treatment — the Tabs recipe's geometry and inks, spoken in token utilities.
  const tabClasses =
    "relative inline-flex items-center gap-8 px-12 py-8 text-sm leading-tight whitespace-nowrap " +
    "transition-colors duration-fast ease-standard";
  const tabInactiveClasses = "font-medium text-text-muted hover:text-text-default";
  const tabActiveClasses = "font-semibold text-text-default";
</script>

<!-- The gold bar over the band's rule — the active mark of the tabs register. -->
{#snippet activeBar()}
  <span
    class="absolute inset-x-12 bottom-0 bg-accent-default"
    style="block-size: var(--mc-focus-ring-width)"
    aria-hidden="true"
  ></span>
{/snippet}

<!-- The design-system menu Item keeps Bits' element delegation closed (see profile-menu.svelte),
     so a section in a menu navigates programmatically — same destination as a strip anchor. -->
{#snippet menuSection(section: MatterSection)}
  {@const current = isCurrentSection(section, page.url.pathname)}
  <DropdownMenu.Item
    onSelect={() => goto(sectionHref(section))}
    aria-current={current ? "page" : undefined}
    class={current ? "font-semibold" : undefined}
  >
    {section.label}
  </DropdownMenu.Item>
{/snippet}

<nav aria-label="Matter sections" class="relative w-full">
  <div class="flex items-center justify-end" bind:clientWidth={overflow.containerWidth}>
    {#each visibleEntries as entry (entryKey(entry))}
      {@const current = isCurrentEntry(entry, page.url.pathname)}
      {#if entry.kind === "section"}
        <a
          href={sectionHref(entry.section)}
          aria-current={current ? "page" : undefined}
          class="{tabClasses} {current ? tabActiveClasses : tabInactiveClasses}"
        >
          {entry.section.label}
          {#if current}{@render activeBar()}{/if}
        </a>
      {:else}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class="{tabClasses} {current
              ? tabActiveClasses
              : tabInactiveClasses} cursor-pointer"
          >
            {entry.label}
            <ChevronDown class="size-16" aria-hidden="true" />
            {#if current}{@render activeBar()}{/if}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
            {#each entry.sections as section (section.slug)}
              {@render menuSection(section)}
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    {/each}
    {#if foldedEntries.length > 0}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="{tabClasses} {activeInFold
            ? tabActiveClasses
            : tabInactiveClasses} cursor-pointer"
        >
          More
          <ChevronDown class="size-16" aria-hidden="true" />
          {#if activeInFold}{@render activeBar()}{/if}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
          {#each foldedEntries as entry (entryKey(entry))}
            {#if entry.kind === "section"}
              {@render menuSection(entry.section)}
            {:else}
              <DropdownMenu.Group>
                <DropdownMenu.GroupHeading>{entry.label}</DropdownMenu.GroupHeading>
                {#each entry.sections as section (section.slug)}
                  {@render menuSection(section)}
                {/each}
              </DropdownMenu.Group>
            {/if}
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>

  <!-- The measuring mirror: every top-level entry plus the More trigger, rendered identically (at
       the active weight, group triggers with their chevron) but invisible, inert, and out of flow,
       so each width can be read without ever being seen. overflow-hidden clips the full-width row
       so it never expands the work canvas's scroll width (each child's clientWidth is intrinsic and
       unaffected by the clip); without it the off-screen mirror grows a phantom horizontal
       scrollbar. -->
  <div
    class="pointer-events-none invisible absolute inset-x-0 top-0 flex items-center overflow-hidden"
    aria-hidden="true"
  >
    {#each matterStrip as entry, index (entryKey(entry))}
      <span class="{tabClasses} {tabActiveClasses}" bind:clientWidth={overflow.itemWidths[index]}>
        {entry.kind === "section" ? entry.section.label : entry.label}
        {#if entry.kind === "group"}
          <ChevronDown class="size-16" aria-hidden="true" />
        {/if}
      </span>
    {/each}
    <span class="{tabClasses} {tabActiveClasses}" bind:clientWidth={overflow.moreTriggerWidth}>
      More
      <ChevronDown class="size-16" aria-hidden="true" />
    </span>
  </div>
</nav>
