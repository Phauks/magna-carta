<script lang="ts">
  /*
   * The matter's ceremonial edge — the Masthead register: the ledger line above the serif title
   * carries the matter number ("Matter 2026-0147"), or the "Consultation" designation while the
   * matter is prospective and unnumbered by design; the status seal sits beside it; the citation
   * meta below names client, type, responsible attorney, and location, omitting what is null.
   *
   * Status never gates or varies the screen flow — it changes only what this header showcases: the
   * seal and the number-or-Consultation line.
   *
   * THE SEAL IS ALSO THE CONTROL. Pressing it opens the status window, which is where a matter is
   * opened, closed or reopened (matter-status-dialog.svelte). There is deliberately no second way
   * in: the lifecycle action used to sit in an overflow menu beside the title, which meant the
   * status was read in one corner and changed in another, and the header carries no overflow menu
   * now that the step it held has a better home. An action that belongs to a fact belongs on it.
   *
   * THE WAY BACK RIDES THE SAME LINE, AS AN ARROW ALONE. The return to the docket is the first
   * thing on the ledger line, ahead of the number, wearing the eyebrow register the number already
   * wears — so the line reads as one ledger rather than as a band of navigation stacked above a
   * heading, and the way out sits where the eye starts.
   *
   * It carries no visible label, which is the one place this differs from the labelled BackLink the
   * tools pages use. That component's rule is right where it applies: above a masthead, a bare
   * arrow leaves a reader guessing which "back" is meant. Here it is unambiguous — a matter came
   * from the docket, the docket is the only place up from it, and the line the arrow sits on names
   * the matter it is leaving. A second caps label beside "MATTER 2026-0147" competed with the
   * number for the same register and read as a breadcrumb trail with one crumb. The accessible name
   * is on the anchor, so the destination is still spoken; it is EyebrowLink directly rather than a
   * label-hiding option on BackLink, because a component whose stated reason for existing is that
   * it names its destination should not grow a mode that does not.
   */
  import EyebrowLink from "@magna-carta/design-system/eyebrow-link";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import MatterStatusDialog from "$lib/matters/matter-status-dialog.svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  /** The docket. Every matter came from it, and it is where the way out leads. */
  const MATTERS_HREF = "/matters";

  let { matter }: { matter: MatterRecord } = $props();

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
        <!-- One link back to the docket is not a breadcrumb trail, so the landmark is named for
             what it is; announcing it as a breadcrumb would send a reader looking for a path that
             is not there. -->
        <nav aria-label="Back to Matters" class="flex">
          <EyebrowLink href={MATTERS_HREF} aria-label="Back to Matters">
            <ArrowLeft class="size-12" aria-hidden="true" />
          </EyebrowLink>
        </nav>
        {matter.matterNumber === null ? "Consultation" : `Matter ${matter.matterNumber}`}
        <!-- The status seal rides the ledger line, beside the matter number — the top-left corner
             is where the matter's status is read, and now also where it is changed. -->
        <MatterStatusDialog {matter} />
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
</Masthead.Root>
