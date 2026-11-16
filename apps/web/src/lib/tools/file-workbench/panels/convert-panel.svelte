<script lang="ts">
  /*
   * Turning files into another format, one or many at once.
   *
   * Bulk is the whole point of this panel. A production arrives as sixty scans and every one of
   * them has to become a PDF; a surface that converts one file at a time makes a person do that
   * sixty times. So this capability acts on the SELECTION, not on the file in focus, and the
   * targets offered are the ones every selected file can actually reach. Offering a format half
   * the selection cannot become, then failing partway, is worse than not offering it.
   *
   * Pressing a format sends each file to the firm's conversion engine in turn and lists how each
   * one went. The original is never replaced: every copy is new, and is offered to save or to put
   * on the bench beside the original.
   */
  import Download from "@lucide/svelte/icons/download";
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import Badge from "@magna-carta/design-system/badge";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Button from "@magna-carta/design-system/button";
  import type { Format } from "@magna-carta/conversion/format";
  import { saveToTarget } from "$lib/export/save-target.ts";
  import FactTable, { type Fact } from "../parts/fact-table.svelte";
  import Absence from "../parts/absence.svelte";
  import SectionHeading from "../parts/section-heading.svelte";
  import { sharedConversionTargets, conversionTargetsFor, formatIdForLabel } from "../conversion-targets.ts";
  import { browserConversionPorts, convertedName, runConversion, type ConversionStage } from "../conversion-run.ts";
  import { describeType, detectedLabelOf } from "../file-facts.ts";
  import type { WorkbenchFile } from "../workbench-file.ts";
  import type { CapabilityPanelProps } from "../capability.ts";

  let { files, onAddFiles }: CapabilityPanelProps = $props();

  type RunRow =
    | { readonly kind: "waiting" }
    | { readonly kind: "working"; readonly stage: ConversionStage }
    | { readonly kind: "converted"; readonly copy: File }
    | { readonly kind: "failed"; readonly message: string };

  interface Run {
    readonly target: Format;
    readonly files: readonly WorkbenchFile[];
    rows: Record<string, RunRow>;
  }

  let run = $state<Run | null>(null);
  const running = $derived(
    run !== null && Object.values(run.rows).some((row) => row.kind === "waiting" || row.kind === "working"),
  );

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

  const STAGE_LABEL: Record<ConversionStage, string> = {
    uploading: "Sending",
    queued: "Queued",
    converting: "Converting",
  };

  async function convertTo(target: Format): Promise<void> {
    const chosen = [...files];
    run = {
      target,
      files: chosen,
      rows: Object.fromEntries(chosen.map((file) => [file.id, { kind: "waiting" } as RunRow])),
    };
    const current = run;
    const ports = browserConversionPorts();
    for (const file of chosen) {
      if (run !== current) return;
      const from = formatIdForLabel(detectedLabelOf(file));
      if (from === null) {
        current.rows[file.id] = { kind: "failed", message: `Nothing converts from ${describeType(file)}.` };
        continue;
      }
      current.rows[file.id] = { kind: "working", stage: "uploading" };
      const outcome = await runConversion(ports, await file.readBytes(), from, target.id, (stage) => {
        current.rows[file.id] = { kind: "working", stage };
      });
      current.rows[file.id] =
        outcome.kind === "converted"
          ? {
              kind: "converted",
              copy: new File([outcome.blob], convertedName(file.name, target), {
                type: outcome.mediaType || target.mediaType,
              }),
            }
          : { kind: "failed", message: outcome.message };
    }
  }

  const convertedCopies = $derived(
    run === null
      ? []
      : Object.values(run.rows).flatMap((row) => (row.kind === "converted" ? [row.copy] : [])),
  );
</script>

<div class="flex flex-col gap-24">
  <FactTable title="This Conversion" {facts} />

  {#if run !== null}
    <DataTable.Root class="w-full">
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>To {run.target.label}</DataTable.Head>
          <DataTable.Head>Result</DataTable.Head>
          <DataTable.Head><span class="sr-only">Actions</span></DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each run.files as file (file.id)}
          {@const row = run.rows[file.id] ?? { kind: "waiting" }}
          <DataTable.Row>
            <DataTable.Cell class="align-top break-words">
              {row.kind === "converted" ? row.copy.name : file.name}
            </DataTable.Cell>
            <DataTable.Cell class="align-top break-words">
              {#if row.kind === "waiting"}
                <Badge variant="neutral">Waiting</Badge>
              {:else if row.kind === "working"}
                <Badge variant="info">{STAGE_LABEL[row.stage]}</Badge>
              {:else if row.kind === "converted"}
                <Badge variant="success">Converted</Badge>
              {:else}
                <Badge variant="danger">Not Converted</Badge>
                <span class="mt-4 block text-xs text-text-muted">{row.message}</span>
              {/if}
            </DataTable.Cell>
            <DataTable.Cell class="text-right align-top whitespace-nowrap">
              {#if row.kind === "converted"}
                {#if onAddFiles !== undefined}
                  <Button variant="secondary" size="sm" onclick={() => onAddFiles([row.copy])}>
                    <FilePlus class="size-16" aria-hidden="true" />
                    Put on the Bench
                  </Button>
                {/if}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Save ${row.copy.name}`}
                  onclick={() => saveToTarget(row.copy, row.copy.name, row.copy.type)}
                >
                  <Download class="size-16" aria-hidden="true" />
                </Button>
              {/if}
            </DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  {/if}

  {#if files.length > 1 && run === null}
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
      <div class="flex flex-wrap items-center gap-8">
        {#each targets as format (format.id)}
          <Button variant="secondary" size="sm" disabled={running} onclick={() => convertTo(format)}>
            {format.label}
          </Button>
        {/each}
        {#if convertedCopies.length > 1 && onAddFiles !== undefined && !running}
          <Button variant="primary" size="sm" onclick={() => onAddFiles(convertedCopies)}>
            <FilePlus class="size-16" aria-hidden="true" />
            Put All {convertedCopies.length} on the Bench
          </Button>
        {/if}
      </div>
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
