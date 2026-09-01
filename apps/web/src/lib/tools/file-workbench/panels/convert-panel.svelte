<script lang="ts">
  /*
   * Turning files into another format, one or many at once.
   *
   * Bulk is the whole point of this panel. A production arrives as sixty scans and every one of
   * them has to become a PDF; a surface that converts one file at a time makes a person do that
   * sixty times. So this capability acts on the SELECTION, not on the file in focus, and the
   * targets offered are the ones every selected file can actually reach — offering a format half
   * the selection cannot become, then failing partway, is worse than not offering it.
   *
   * IT DOES NOT RESTATE ITSELF. The panel used to open by naming the file it was about to convert
   * and explaining that a conversion produces a new file. The file is named at the top of the
   * readings, and that a conversion produces something is what the word means. What a reader
   * cannot work out on their own is which formats this file can reach, so that is all this panel
   * says.
   *
   * TARGETS ARE FILE TYPES. Not treatments of a file type: the graph carries a text-layered PDF as
   * its own node, and offering it beside PDF asks a reader to choose how much of their document
   * survives. Every PDF the converter produces carries as much as it can, so there is one PDF
   * button. `conversion-targets.ts` is where that collapse happens.
   *
   * The original is never replaced. A conversion produces a new file beside it.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Button from "@magna-carta/design-system/button";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import Absence from "../parts/absence.svelte";
  import SectionHeading from "../parts/section-heading.svelte";
  import { sharedConversionTargets, conversionTargetsFor } from "../conversion-targets.ts";
  import { describeType, detectedLabelOf } from "../file-facts.ts";
  import type { CapabilityPanelProps } from "../capability.ts";

  let { files }: CapabilityPanelProps = $props();

  const labels = $derived(files.map((file) => detectedLabelOf(file)));
  const targets = $derived(sharedConversionTargets(labels));
  // Named so the panel can say WHICH files are the reason a shared target list came out short,
  // rather than leaving a person to work out why their format vanished when they selected more.
  const withoutTargets = $derived(
    files.filter((file) => conversionTargetsFor(detectedLabelOf(file)).length === 0),
  );
</script>

<div class="flex flex-col gap-24">
  <div class="flex flex-col gap-8">
    <SectionHeading>Convert To</SectionHeading>
    {#if targets.length > 0}
      <SoonAffordance reason="the conversion container" reasonPlacement="line">
        {#snippet control(soon)}
          <div class="flex flex-wrap gap-8">
            {#each targets as format (format.id)}
              <Button variant="secondary" {...soon}>{format.label}</Button>
            {/each}
          </div>
        {/snippet}
      </SoonAffordance>
    {:else if withoutTargets.length > 0}
      <Absence
        kind="not-applicable"
        reason={files.length === 1
          ? `Nothing converts from ${describeType(files[0]!)}.`
          : `${withoutTargets.length} of the selected files convert to nothing, so the selection shares no target. Narrow the selection to see what the rest can become.`}
      />
    {:else}
      <Absence
        kind="not-applicable"
        reason="These files share no format they can all become. Narrow the selection."
      />
    {/if}
  </div>

  <!-- Only for a selection, and only because a shared target list is an intersection: when a format
       is missing, the answer is in which files are in the set and what they read as. One file needs
       none of this — it is named above the tabs. -->
  {#if files.length > 1}
    <div class="flex flex-col gap-8">
      <SectionHeading>Converting {files.length} Files</SectionHeading>
      <DataTable.Root class="w-full rounded-none border-0">
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>File</DataTable.Head>
            <DataTable.Head>Reads as</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each files as file (file.id)}
            <DataTable.Row>
              <DataTable.Cell class="max-w-0 truncate" title={file.name}>{file.name}</DataTable.Cell>
              <DataTable.Cell class="text-text-muted">{describeType(file)}</DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    </div>
  {/if}
</div>
