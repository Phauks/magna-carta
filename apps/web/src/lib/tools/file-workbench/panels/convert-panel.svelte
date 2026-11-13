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
   * The original is never replaced. A conversion produces a new file beside it.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Button from "@magna-carta/design-system/button";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";
  import FactTable, { type Fact } from "../parts/fact-table.svelte";
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

  const facts = $derived.by((): Fact[] => [
    {
      label: "Converting",
      value:
        files.length === 1
          ? `${files[0]?.name ?? ""} (${describeType(files[0]!)})`
          : `${files.length} files`,
    },
    { label: "Produces", value: "A new file beside each original. The originals are untouched." },
  ]);
</script>

<div class="flex flex-col gap-24">
  <FactTable title="This Conversion" {facts} />

  {#if files.length > 1}
    <DataTable.Root class="w-full">
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
  {/if}

  <div class="flex flex-col gap-8">
    <SectionHeading>Convert To</SectionHeading>
    {#if targets.length > 0}
      <SoonAffordance reason="file conversion" reasonPlacement="line">
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
          : `${withoutTargets.length} of the selected files can't be converted, so there's no shared format. Narrow the selection to see options for the rest.`}
      />
    {:else}
      <Absence
        kind="not-applicable"
        reason="These files share no format they can all become. Narrow the selection."
      />
    {/if}
  </div>
</div>
