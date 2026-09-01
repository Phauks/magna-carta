<script lang="ts">
  /*
   * The matter's header band — the ceremonial edge and the section navigation, in ONE band.
   *
   * The arrangement (owner's selections, 2026-08-31 and 2026-09-01): the identity block on the
   * reading edge, the section strip and the overflow control sharing ONE row at the inline end,
   * flush against the band's bottom rule. 152px of chrome became 111px when the strip moved off
   * its own row, and 76px when the identity block stopped spending three rows on itself.
   *
   * WHY THE OVERFLOW CONTROL IS ON THE STRIP'S ROW, AND NOT ABOVE IT. Stacked, that column is the
   * control (40px) over the strip (41px) with a gap between them — 89px, which floored the whole
   * band at 90px however short the identity block got. Three quite different identity treatments
   * were measured at exactly 90px because of it. One row at the inline end is 41px, and the
   * identity block sets the height again. The control carries `pb-8` so it sits ABOVE the rule
   * rather than on it: the rule belongs to the sections, whose gold active bar draws on it, and a
   * bordered button sitting on it reads as part of the strip.
   *
   * THE LEDGER LINE HAS NO ROW OF ITS OWN. The matter number and its status seal lead the citation
   * beneath the title, where they still read first, instead of costing a full line above it. That
   * is a whole row rather than a few points of type, which is why it beat shrinking the title
   * further — at the next step down the display face is close enough to the citation that the
   * masthead register's scale contrast nearly goes.
   *
   * THE TITLE TRUNCATES; IT DOES NOT WRAP. At a 1024 canvas there is not room for a full-scale
   * serif title AND a useful strip on one row, and only three things can give. Letting the title
   * wrap was measured first: the citation follows it down and the band ends up TALLER than the two
   * rows this arrangement replaced, which defeats the whole point. Letting the identity block hold
   * its natural width instead starves the strip — it fell to a single tab plus More at 1060. So
   * the two sides share the row evenly and the title takes an ellipsis, with the full name on the
   * element's `title` for the hover and in the document title either way. The band is then one
   * height at every canvas width, which is the property this arrangement was chosen for.
   *
   * The Masthead recipe is the one door to the display serif, so the identity block still composes
   * Masthead.Heading and takes its step from the recipe's own `density` rather than a type utility
   * on the Title. The Actions slot is left unused: this action belongs to the strip's row, not to
   * the title's inline end.
   *
   * Status never gates or varies the screen flow — it changes only what this header showcases:
   * the seal, the number-or-Consultation line, and which lifecycle action label is offered.
   *
   * Actions collapse into one toggleable overflow (⋯) menu — the menu opens for real, and its
   * items (the status's lifecycle action) are honest seams: designed-but-unwired ships visible and
   * disabled, marked "Soon", never omitted and never fake-live. They go live with the wired
   * matters surface.
   */
  import Badge from "@magna-carta/design-system/badge";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Archive from "@lucide/svelte/icons/archive";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import MatterSectionNav from "$lib/matters/matter-section-nav.svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import { matterStatusPresentation } from "$lib/matters/matter-status.ts";

  let { matter }: { matter: MatterRecord } = $props();

  // One lifecycle action per status: the single next step the matter's life offers. Closing
  // archives (Archive, not a destructive glyph — the record stays additive after close).
  const LIFECYCLE_ACTION: Record<
    MatterRecord["status"],
    { label: string; icon: typeof Archive }
  > = {
    prospective: { label: "Open matter", icon: FolderOpen },
    open: { label: "Close matter", icon: Archive },
    closed: { label: "Reopen", icon: RotateCcw },
  };

  // The status seal comes from the one matter-status register, so the header and the docket's
  // status column can never disagree about what "Closed" looks like.
  const seal = $derived(matterStatusPresentation(matter.status));
  const lifecycle = $derived(LIFECYCLE_ACTION[matter.status]);
  const LifecycleIcon = $derived(lifecycle.icon);

  // The citation line's entries in reading order, nulls dropped — a consultation simply has a
  // shorter citation, never an empty slot.
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

  /*
   * The citation as ONE string rather than a row of spans. The band's height is only constant if
   * this line cannot wrap, and a flex row of separate entries cannot ellipsis: truncating each
   * entry to its share gives four stubs and no citation (measured), while clipping the row cuts a
   * word in half with nothing to say it was cut. Joined, the line reads as far as it fits and
   * stops. The cost is the interpunct's own lighter ink — it is text here, not a separator
   * element — which is the smaller loss.
   */
  const citation = $derived(metaEntries.join(" · "));

  const ledgerLine = $derived(
    matter.matterNumber === null ? "Consultation" : `Matter ${matter.matterNumber}`,
  );
</script>

<Masthead.Root density="compact" class="items-stretch border-b border-border-default">
  <Masthead.Heading class="min-w-0 max-w-2xl flex-1 pb-16">
    <Masthead.Title class="truncate" title={matter.title}>{matter.title}</Masthead.Title>
    <Masthead.Meta class="flex-nowrap">
      <!-- The ledger line and the status seal lead the citation: still the first thing read on the
           line, without costing a line of their own. Both hold their width so the citation is what
           gives when the band narrows. -->
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
  </Masthead.Heading>

  <div class="flex min-w-0 flex-1 items-end justify-end gap-8">
    <div class="min-w-0 flex-1">
      <MatterSectionNav matterId={matter.id} />
    </div>
    <div class="flex flex-none items-center pb-8">
      <DropdownMenu.Root>
        <!-- The overflow (⋯) carries a token border so it reads as a control at rest, not just on
             hover — the quiet ghost was too easy to miss. The lifecycle action lives inside it,
             disabled and marked Soon until the wired matters surface makes it live. -->
        <DropdownMenu.Trigger
          class="{buttonClasses({ variant: 'ghost', size: 'icon' })} border border-border-default"
          aria-label="Matter actions"
        >
          <Ellipsis class="size-16" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
          <DropdownMenu.Item disabled>
            <LifecycleIcon class="size-16" aria-hidden="true" />
            {lifecycle.label}
            <Badge variant="neutral" class="ms-auto">Soon</Badge>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>
</Masthead.Root>
