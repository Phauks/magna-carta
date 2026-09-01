<script lang="ts">
  /*
   * The matter's ceremonial edge — the Masthead register: the ledger line above the serif title
   * carries the matter number ("Matter 2026-0147"), or the "Consultation" designation while the
   * matter is prospective and unnumbered by design; the status seal sits beside it; the citation
   * meta below names client, type, responsible attorney, and location, omitting what is null.
   *
   * Status never gates or varies the screen flow — it changes only what this header showcases:
   * the seal, the number-or-Consultation line, and which lifecycle action label is offered.
   *
   * Actions collapse into one toggleable overflow (⋯) menu — the menu opens for real, and its
   * items (Edit and the status's lifecycle action) are honest seams: designed-but-unwired ships
   * visible and disabled, marked "Soon", never omitted and never fake-live. They go live with the
   * wired matters surface.
   */
  import Badge from "@magna-carta/design-system/badge";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Archive from "@lucide/svelte/icons/archive";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import MatterSearchControl from "$lib/matters/matter-search-control.svelte";
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
</script>

<Masthead.Root>
  <Masthead.Heading>
    <Masthead.Eyebrow>
      <span class="flex items-center gap-8">
        {matter.matterNumber === null ? "Consultation" : `Matter ${matter.matterNumber}`}
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
    <Masthead.Title>{matter.title}</Masthead.Title>
    <Masthead.Meta>
      {#each metaEntries as entry, index (entry)}
        {#if index > 0}
          <Masthead.MetaSeparator />
        {/if}
        <span>{entry}</span>
      {/each}
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    {@const LifecycleIcon = lifecycle.icon}
    <!-- The search sits to the INLINE START of the overflow, and the order is load-bearing:
         ScreenSearch always grows toward the inline start, so a field placed after the overflow
         would shove it sideways on the first keystroke. Rendering it here — in the header, from the
         matter layout — is what puts one search on every section and stops a section growing its
         own. -->
    <MatterSearchControl matterId={matter.id} />
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
  </Masthead.Actions>
</Masthead.Root>
