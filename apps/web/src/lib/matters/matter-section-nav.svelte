<script lang="ts">
  /*
   * The matter's section strip — route-driven navigation styled in the tabs register. The design
   * system's Tabs is Bits UI's state-based ARIA tablist, the wrong semantics for links that
   * change the address, so this strip renders real anchors inside a nav landmark and speaks the
   * Tabs recipe's visual language through tokens (hairline track, quiet triggers, the gold bar
   * under the active section). No tablist ARIA is faked onto the links; the current section is
   * stated with aria-current="page". One identical strip for every matter status — status never
   * gates navigation.
   *
   * Overflow is measurement-driven, not breakpoint-driven: an invisible mirror of the full strip
   * reports each tab's width (bind:clientWidth), and as the container narrows, trailing sections
   * fold into the More menu. The registry orders non-core sections last, so they fold first and
   * trailing core sections follow only when the strip is genuinely too narrow. The arithmetic and
   * the two rules it has to keep live in section-overflow.svelte.ts.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import { SectionOverflow } from "$lib/matters/section-overflow.svelte.ts";
  import { matterSections, type MatterSection } from "$lib/matters/sections.ts";

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

  const overflow = new SectionOverflow(() => matterSections.length);

  const visibleSections = $derived(matterSections.slice(0, overflow.visibleCount));
  const overflowSections = $derived(matterSections.slice(overflow.visibleCount));
  const activeInOverflow = $derived(
    overflowSections.some((section) => isCurrentSection(section, page.url.pathname)),
  );

  // The shared tab treatment — the Tabs recipe's geometry and inks, spoken in token utilities.
  const tabClasses =
    "relative inline-flex items-center gap-8 px-12 py-8 text-sm leading-tight whitespace-nowrap " +
    "transition-colors duration-fast ease-standard";
  const tabInactiveClasses = "font-medium text-text-muted hover:text-text-default";
  const tabActiveClasses = "font-semibold text-text-default";
</script>

<nav aria-label="Matter sections" class="relative border-b border-border-default">
  <div class="flex items-center" bind:clientWidth={overflow.containerWidth}>
    {#each visibleSections as section (section.slug)}
      {@const current = isCurrentSection(section, page.url.pathname)}
      <a
        href={sectionHref(section)}
        aria-current={current ? "page" : undefined}
        class="{tabClasses} {current ? tabActiveClasses : tabInactiveClasses}"
      >
        {section.label}
        <MaturityBadge stage={section.stage} />
        {#if current}
          <!-- The gold bar over the track — the active mark of the tabs register. -->
          <span
            class="absolute inset-x-12 bottom-0 bg-accent-default"
            style="block-size: var(--mc-focus-ring-width)"
            aria-hidden="true"
          ></span>
        {/if}
      </a>
    {/each}
    {#if overflowSections.length > 0}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="{tabClasses} {activeInOverflow
            ? tabActiveClasses
            : tabInactiveClasses} cursor-pointer"
        >
          More
          <ChevronDown class="size-16" aria-hidden="true" />
          {#if activeInOverflow}
            <!-- The folded-away active section still shows on the strip: More carries its mark. -->
            <span
              class="absolute inset-x-12 bottom-0 bg-accent-default"
              style="block-size: var(--mc-focus-ring-width)"
              aria-hidden="true"
            ></span>
          {/if}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
          {#each overflowSections as section (section.slug)}
            {@const current = isCurrentSection(section, page.url.pathname)}
            <!-- The design-system menu Item keeps Bits' element delegation closed (see
                 profile-menu.svelte), so a folded section navigates programmatically — same
                 destination as its strip anchor. -->
            <DropdownMenu.Item
              onSelect={() => goto(sectionHref(section))}
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

  <!-- The measuring mirror: every tab plus the More trigger, rendered identically (at the active
       weight, badges included) but invisible, inert, and out of flow, so each width can be read
       without ever being seen. overflow-hidden clips the full-width row so it never expands the
       work canvas's scroll width (each child's clientWidth is intrinsic and unaffected by the
       clip); without it the off-screen mirror grows a phantom horizontal scrollbar. -->
  <div
    class="pointer-events-none invisible absolute inset-x-0 top-0 flex items-center overflow-hidden"
    aria-hidden="true"
  >
    {#each matterSections as section, index (section.slug)}
      <span class="{tabClasses} {tabActiveClasses}" bind:clientWidth={overflow.itemWidths[index]}>
        {section.label}
        <MaturityBadge stage={section.stage} />
      </span>
    {/each}
    <span class="{tabClasses} {tabActiveClasses}" bind:clientWidth={overflow.moreTriggerWidth}>
      More
      <ChevronDown class="size-16" aria-hidden="true" />
    </span>
  </div>
</nav>
