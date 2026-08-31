<script lang="ts">
  /*
   * The matter's identity block, at either of the two scales the candidates need: the ceremonial
   * masthead the product ships (eyebrow over serif title over citation meta), and a compact
   * single-line reading of the same facts for the candidate that spends one row on everything.
   *
   * The title renders at heading level 3 because five specimens share one page; a promoted
   * arrangement restores level 1, which is the masthead's default and the matter screen's h1.
   *
   * Both read the same registers the shipped header reads — the status seal from
   * matter-status.ts, the citation entries in the same order, nulls dropped — so a candidate can
   * change the arrangement of these facts and never their content.
   */
  import Badge from "@magna-carta/design-system/badge";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import { matterStatusPresentation } from "$lib/matters/matter-status.ts";

  let { matter, scale = "display" }: { matter: MatterRecord; scale?: "display" | "compact" } =
    $props();

  const seal = $derived(matterStatusPresentation(matter.status));

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

  // The interpunct that Masthead.MetaSeparator draws, as a character: a truncating single line
  // cannot be built out of sibling elements.
  const compactCitation = $derived(metaEntries.join(" · "));

  const ledgerLine = $derived(
    matter.matterNumber === null ? "Consultation" : `Matter ${matter.matterNumber}`,
  );
</script>

{#if scale === "display"}
  <Masthead.Heading>
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
    <Masthead.Title level={3}>{matter.title}</Masthead.Title>
    <Masthead.Meta>
      {#each metaEntries as entry, index (entry)}
        {#if index > 0}
          <Masthead.MetaSeparator />
        {/if}
        <span>{entry}</span>
      {/each}
    </Masthead.Meta>
  </Masthead.Heading>
{:else}
  <!-- One line: the ledger number, the title at reading scale, the seal, and the citation trailing
       behind it. The display face does not come with it: the Masthead recipe is that face's only
       door by design, so a matter on this arrangement reads in the working sans and the citation
       truncates rather than wrapping the band to a second row. -->
  <div class="flex min-w-0 items-baseline gap-8">
    <span
      class="flex-none text-xs font-semibold text-text-subtle uppercase"
      style="letter-spacing: var(--mc-tracking-caps)"
    >
      {ledgerLine}
    </span>
    <h3 class="m-0 flex-none text-lg leading-tight font-semibold text-text-default">
      {matter.title}
    </h3>
    <Badge
      variant={seal.variant}
      class="flex-none uppercase"
      style="letter-spacing: var(--mc-tracking-caps)"
    >
      {seal.label}
    </Badge>
    <!-- One string, not a row of spans: truncating each entry separately gives four stubs and no
         citation. Joined, the line reads as far as it fits and stops. -->
    <span class="min-w-0 truncate text-sm text-text-muted">{compactCitation}</span>
  </div>
{/if}
