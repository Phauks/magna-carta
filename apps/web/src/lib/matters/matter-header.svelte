<script lang="ts">
  /*
   * The matter's header band — the ceremonial edge and the section navigation, in ONE band.
   *
   * The arrangement (owner's selection, 2026-08-31): the identity block on the reading edge, and
   * the inline-end half of the band — which previously held one overflow control and otherwise
   * nothing — carrying a column of its own: the actions on the title's row, the section strip
   * beneath them, packed to the end and flush against the band's bottom rule. The strip no longer
   * costs a row of its own, and the masthead keeps every bit of its ceremony: the serif title at
   * masthead scale, the ledger line, the citation.
   *
   * THE STRIP SITS ON THE RULE ON PURPOSE. `justify-between` pins the actions to the top of the
   * column and the strip to the bottom, so the gold active bar lands on the band's own border
   * rather than floating in the middle of it. That is why the band draws the rule and the nav
   * does not.
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
   * Masthead.Heading — only the Actions slot is left unused, because these actions belong to the
   * column and not to the title's inline end.
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
</script>

<Masthead.Root class="items-stretch border-b border-border-default">
  <Masthead.Heading class="min-w-0 max-w-2xl flex-1 pb-16">
    <Masthead.Eyebrow>
      <span class="flex items-center gap-8">
        <!--
          The number the file is called by, in the one place the eye goes for it. A consultation
          wears its own tentative number and is LABELLED as one, so nobody reads it as a matter
          number; once the matter opens, the permanent number takes the line.
        -->
        {matter.matterNumber !== null
          ? `Matter ${matter.matterNumber}`
          : matter.consultationNumber !== null
            ? `Consultation ${matter.consultationNumber}`
            : "Consultation"}
        <!-- The status seal rides the ledger line, beside the matter number — the top-left corner
             is where the matter's standing is read, not the action rail. -->
        <Badge
          variant={seal.variant}
          class="uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          {seal.label}
        </Badge>
      </span>
    </Masthead.Eyebrow>
    <Masthead.Title class="truncate" title={matter.title}>{matter.title}</Masthead.Title>
    <Masthead.Meta class="flex-nowrap">
      <span class="truncate" title={citation}>{citation}</span>
    </Masthead.Meta>
  </Masthead.Heading>

  <div class="flex min-w-0 flex-1 flex-col items-end justify-between gap-8">
    <div class="flex flex-none items-center gap-8 pt-4">
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

    <MatterSectionNav matterId={matter.id} />
  </div>
</Masthead.Root>
