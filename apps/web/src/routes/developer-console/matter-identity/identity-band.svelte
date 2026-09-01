<script lang="ts">
  /*
   * The matter's header band with its identity block under review — ONE component taking the two
   * decisions that are actually in play, rather than five near-copies of a band.
   *
   *   density — the title's step, from the Masthead recipe's own variant (default 2rem, compact
   *             1.5rem, dense 1.25rem). Never a utility on the Title: the recipe owns the display
   *             scale, which is the whole reason it is the only door to that face.
   *   actions — whether the overflow control keeps a row above the strip, or joins the strip's own
   *             row at its end. This is the knob that moves the FLOOR: stacked, the inline-end
   *             column is the control (40px) over the strip (41px) with a gap, so the band cannot
   *             go below 89px however short the identity gets. Inline, that column becomes one row
   *             and the identity block sets the height again.
   *   layout  — how many rows the identity spends. `stacked` is what ships today (the ledger line
   *             and seal on their own row above the title); `folded` drops that row by letting the
   *             number and seal lead the citation beneath the title; `inline` puts everything on
   *             one line with the citation trailing.
   *
   * Everything to the inline end is the shipping arrangement, unchanged and not under review — the
   * real MatterSectionNav, so the band's measured height is the real one. The strip shows no active
   * section here because nothing on this route is a matter section; that costs the gold bar in the
   * specimen and nothing in the measurement.
   */
  import Badge from "@magna-carta/design-system/badge";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import type { MastheadDensity } from "@magna-carta/design-system/masthead";
  import Archive from "@lucide/svelte/icons/archive";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import MatterSectionNav from "$lib/matters/matter-section-nav.svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import { matterStatusPresentation } from "$lib/matters/matter-status.ts";

  let {
    matter,
    density = "default",
    layout = "stacked",
    actions = "stacked",
    chromeHeight = $bindable(0),
  }: {
    matter: MatterRecord;
    density?: MastheadDensity;
    layout?: "stacked" | "folded" | "inline";
    actions?: "stacked" | "inline";
    chromeHeight?: number;
  } = $props();

  const seal = $derived(matterStatusPresentation(matter.status));

  const ledgerLine = $derived(
    matter.matterNumber === null ? "Consultation" : `Matter ${matter.matterNumber}`,
  );

  const metaEntries = $derived(
    [
      matter.clientDisplayName === null
        ? null
        : matter.clientCode === null
          ? matter.clientDisplayName
          : `${matter.clientDisplayName} (${matter.clientCode})`,
      matter.matterTypeName,
      matter.responsibleAttorneyName,
      matter.locationName,
    ].filter((entry): entry is string => entry !== null),
  );

  // One string, so the line can ellipsis: a flex row of separate entries cannot, and truncating
  // each entry to its share gives stubs instead of a citation.
  const citation = $derived(metaEntries.join(" · "));
</script>

{#snippet overflowMenu()}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="{buttonClasses({ variant: 'ghost', size: 'icon' })} border border-border-default"
      aria-label="Matter actions"
    >
      <Ellipsis class="size-16" aria-hidden="true" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
      <DropdownMenu.Item disabled>
        <Archive class="size-16" aria-hidden="true" />
        Close matter
        <Badge variant="neutral" class="ms-auto">Soon</Badge>
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<div bind:clientHeight={chromeHeight}>
  <Masthead.Root {density} class="items-stretch border-b border-border-default">
  <Masthead.Heading class="min-w-0 max-w-2xl flex-1 pb-16">
    {#if layout === "stacked"}
      <Masthead.Eyebrow>
        <span class="flex items-center gap-8">
          {ledgerLine}
          <Badge
            variant={seal.variant}
            class="uppercase"
            style="letter-spacing: var(--mc-tracking-caps)"
          >
            {seal.label}
          </Badge>
        </span>
      </Masthead.Eyebrow>
      <Masthead.Title level={3} class="truncate" title={matter.title}>{matter.title}</Masthead.Title>
      <Masthead.Meta class="flex-nowrap">
        <span class="truncate" title={citation}>{citation}</span>
      </Masthead.Meta>
    {:else if layout === "folded"}
      <!-- The ledger row is gone: the number and the seal lead the citation instead, where they
           still read first and cost no line of their own. -->
      <Masthead.Title level={3} class="truncate" title={matter.title}>{matter.title}</Masthead.Title>
      <Masthead.Meta class="flex-nowrap">
        <span
          class="flex-none text-xs font-semibold text-text-subtle uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          {ledgerLine}
        </span>
        <Badge
          variant={seal.variant}
          class="flex-none uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          {seal.label}
        </Badge>
        <Masthead.MetaSeparator />
        <span class="truncate" title={citation}>{citation}</span>
      </Masthead.Meta>
    {:else}
      <!-- One line: the ledger, the title, the seal, and the citation trailing behind them. -->
      <div class="flex min-w-0 items-baseline gap-8">
        <span
          class="flex-none text-xs font-semibold text-text-subtle uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          {ledgerLine}
        </span>
        <Masthead.Title level={3} class="flex-none" title={matter.title}>
          {matter.title}
        </Masthead.Title>
        <Badge
          variant={seal.variant}
          class="flex-none uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          {seal.label}
        </Badge>
        <span class="min-w-0 truncate text-sm text-text-muted" title={citation}>{citation}</span>
      </div>
    {/if}
  </Masthead.Heading>

  {#if actions === "stacked"}
    <div class="flex min-w-0 flex-1 flex-col items-end justify-between gap-8">
      <div class="flex flex-none items-center gap-8 pt-4">
        {@render overflowMenu()}
      </div>
      <MatterSectionNav matterId={matter.id} />
    </div>
  {:else}
    <!-- One row at the inline end: the strip, then the overflow control closing it. The control
         sits above the band's rule rather than on it (pb-8), because the gold active bar belongs
         to the sections and a bordered button sitting on the rule reads as part of the strip. -->
    <div class="flex min-w-0 flex-1 items-end justify-end gap-8">
      <MatterSectionNav matterId={matter.id} />
      <div class="flex flex-none items-center pb-8">
        {@render overflowMenu()}
      </div>
    </div>
  {/if}
  </Masthead.Root>
</div>
