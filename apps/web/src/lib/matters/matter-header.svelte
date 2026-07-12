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
  import Badge, { type BadgeVariant } from "@magna-carta/design-system/badge";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import type { Icon as IconType } from "@lucide/svelte";
  import Archive from "@lucide/svelte/icons/archive";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import type { MatterFixture } from "$lib/matters/fixtures.ts";

  let { matter }: { matter: MatterFixture } = $props();

  // The status seal, in the subtle badge register. Closed is archived-but-additive — a matter
  // can still accrue record after closing — so it reads quiet neutral, never destructive red.
  const STATUS_SEAL: Record<MatterFixture["status"], { label: string; variant: BadgeVariant }> = {
    prospective: { label: "Prospective", variant: "info" },
    open: { label: "Open", variant: "success" },
    closed: { label: "Closed", variant: "neutral" },
  };

  // One lifecycle action per status: the single next step the matter's life offers. Closing
  // archives (Archive, not a destructive glyph — the record stays additive after close).
  const LIFECYCLE_ACTION: Record<
    MatterFixture["status"],
    { label: string; icon: typeof IconType }
  > = {
    prospective: { label: "Open matter", icon: FolderOpen },
    open: { label: "Close matter", icon: Archive },
    closed: { label: "Reopen", icon: RotateCcw },
  };

  const seal = $derived(STATUS_SEAL[matter.status]);
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
      {matter.matterNumber === null ? "Consultation" : `Matter ${matter.matterNumber}`}
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
    <!-- The status seal sits with the actions — right where you act on it — rather than up in the
         eyebrow: the lifecycle action in the menu is the thing that changes it. Closed reads quiet
         neutral (archived-but-additive), never destructive. -->
    <Badge variant={seal.variant} class="uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      {seal.label}
    </Badge>
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
