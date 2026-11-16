<script lang="ts">
  /*
   * Repair: diagnose first, then a copy and an account of what was lost.
   *
   * Nothing runs until it is asked for, because each step sends the file to the firm's repair
   * engine (the request answers and keeps nothing). The diagnosis lists each problem the engine
   * found and how much of the file it thinks can come back. Repairing writes a copy; carving pulls
   * whole files of known kinds out of bytes too damaged to repair. Either way the loss list says
   * exactly what came back and what did not, and the copies are offered to save or to put on the
   * bench. The engine scans every copy for malware before it returns it. The original is never
   * changed.
   */
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import ScanSearch from "@lucide/svelte/icons/scan-search";
  import Wrench from "@lucide/svelte/icons/wrench";
  import Download from "@lucide/svelte/icons/download";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { problemGuidance } from "$lib/documents/document-presentation.ts";
  import type { ApiOutcome } from "$lib/api/request.ts";
  import { saveToTarget } from "$lib/export/save-target.ts";
  import Absence from "../parts/absence.svelte";
  import FactTable from "../parts/fact-table.svelte";
  import { base64ToBytes } from "../base64.ts";
  import {
    carveFile,
    diagnoseFile,
    repairFile,
    type RepairDiagnosis,
    type RepairResult,
    type SalvagedFile,
  } from "../file-tools-api.ts";
  import { corruptionName, markedName, recoverabilityOf } from "../file-tools-reading.ts";
  import type { CapabilityPanelProps } from "../capability.ts";

  let { file, onAddFiles }: CapabilityPanelProps = $props();

  let diagnosis = $state<RepairDiagnosis | null>(null);
  let result = $state<{ readonly kind: "repaired" | "carved"; readonly value: RepairResult } | null>(null);
  let busy = $state<"diagnosing" | "repairing" | "carving" | null>(null);
  let failure = $state<string | null>(null);

  // A different file starts from nothing: a diagnosis belongs to the bytes it was made from.
  $effect(() => {
    void file;
    diagnosis = null;
    result = null;
    failure = null;
  });

  function failureOf(outcome: Exclude<ApiOutcome<unknown>, { kind: "ok" }>): string {
    if (outcome.kind === "transport") return "Couldn't connect. The file was not changed.";
    if (outcome.problem.status === 503) return "The repair engine is not running yet. The file was not changed.";
    if (outcome.problem.status === 413) return "This file is larger than the repair engine takes.";
    return problemGuidance(outcome.problem).message;
  }

  async function diagnose(): Promise<void> {
    busy = "diagnosing";
    failure = null;
    result = null;
    try {
      const outcome = await diagnoseFile(await file.readBytes());
      if (outcome.kind === "ok") diagnosis = outcome.value;
      else failure = failureOf(outcome);
    } finally {
      busy = null;
    }
  }

  async function salvage(kind: "repaired" | "carved"): Promise<void> {
    busy = kind === "repaired" ? "repairing" : "carving";
    failure = null;
    try {
      const bytes = await file.readBytes();
      const outcome = kind === "repaired" ? await repairFile(bytes) : await carveFile(bytes);
      if (outcome.kind === "ok") result = { kind, value: outcome.value };
      else failure = failureOf(outcome);
    } finally {
      busy = null;
    }
  }

  function copyOf(salvaged: SalvagedFile): File {
    const name =
      result?.kind === "repaired" && result.value.files.length === 1
        ? markedName(file.name, "repaired")
        : salvaged.name;
    return new File([base64ToBytes(salvaged.contentBase64)], name, {
      type: salvaged.mediaType ?? "application/octet-stream",
    });
  }

  async function save(salvaged: SalvagedFile): Promise<void> {
    const copy = copyOf(salvaged);
    await saveToTarget(copy, copy.name, copy.type);
  }

  const verdict = $derived(diagnosis === null ? null : recoverabilityOf(diagnosis));
</script>

<div class="@container flex flex-col gap-24">
  {#if diagnosis === null}
    <Absence kind="not-run" reason="Not diagnosed yet." />
  {:else}
    <div class="flex flex-wrap items-center gap-8">
      {#if verdict !== null}<Badge variant={verdict.tone}>{verdict.label}</Badge>{/if}
      {#if diagnosis.detectedFormat !== null}
        <span class="text-sm text-text-subtle">Reads as {diagnosis.detectedFormat}</span>
      {/if}
    </div>

    {#if diagnosis.corruption.length > 0}
      <DataTable.Root class="w-full">
        <DataTable.Header>
          <DataTable.Row><DataTable.Head>Problems Found</DataTable.Head></DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each diagnosis.corruption as code (code)}
            <DataTable.Row><DataTable.Cell class="break-words">{corruptionName(code)}</DataTable.Cell></DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    {/if}

    {#if diagnosis.detail.trim() !== ""}
      <FactTable title="Engine Notes" facts={[{ label: "Detail", value: diagnosis.detail }]} />
    {/if}
  {/if}

  {#if result !== null}
    {#if result.value.loss.items.length > 0}
      <DataTable.Root class="w-full">
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>{result.kind === "repaired" ? "Repaired Copy" : "Carved Out"}</DataTable.Head>
            <DataTable.Head>Result</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each result.value.loss.items as item, position (position)}
            <DataTable.Row>
              <DataTable.Cell class="align-top break-words">{item.name}</DataTable.Cell>
              <DataTable.Cell class="align-top break-words">
                <Badge variant={item.recovered ? "success" : "danger"}>{item.recovered ? "Recovered" : "Lost"}</Badge>
                {#if item.detail.trim() !== ""}
                  <span class="mt-4 block text-xs text-text-muted">{item.detail}</span>
                {/if}
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    {/if}

    {#if result.value.files.length === 0}
      <Absence kind="not-applicable" reason="Nothing could be recovered from this file." />
    {:else}
      <DataTable.Root class="w-full">
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Copies</DataTable.Head>
            <DataTable.Head><span class="sr-only">Actions</span></DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each result.value.files as salvaged, position (position)}
            <DataTable.Row>
              <DataTable.Cell class="break-words">{copyOf(salvaged).name}</DataTable.Cell>
              <DataTable.Cell class="text-right whitespace-nowrap">
                {#if onAddFiles !== undefined}
                  <Button variant="secondary" size="sm" onclick={() => onAddFiles([copyOf(salvaged)])}>
                    <FilePlus class="size-16" aria-hidden="true" />
                    Put on the Bench
                  </Button>
                {/if}
                <Button variant="ghost" size="sm" aria-label={`Save ${copyOf(salvaged).name}`} onclick={() => save(salvaged)}>
                  <Download class="size-16" aria-hidden="true" />
                </Button>
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    {/if}
  {/if}

  <div class="flex flex-wrap items-center gap-16 border-t border-border-default pt-16">
    <Button variant={diagnosis === null ? "primary" : "secondary"} size="sm" disabled={busy !== null} onclick={diagnose}>
      <ScanSearch class="size-16" aria-hidden="true" />
      {busy === "diagnosing" ? "Diagnosing" : diagnosis === null ? "Diagnose the File" : "Diagnose Again"}
    </Button>
    {#if diagnosis !== null}
      <Button
        variant="primary"
        size="sm"
        disabled={busy !== null || !diagnosis.repairSupported}
        onclick={() => salvage("repaired")}
      >
        <Wrench class="size-16" aria-hidden="true" />
        {busy === "repairing" ? "Repairing" : "Repair a Copy"}
      </Button>
      <Button variant="secondary" size="sm" disabled={busy !== null} onclick={() => salvage("carved")}>
        <ScanSearch class="size-16" aria-hidden="true" />
        {busy === "carving" ? "Carving" : "Carve Out What Can Be Read"}
      </Button>
      <span class="text-sm text-text-subtle">
        {diagnosis.repairSupported
          ? "Each copy is scanned before it is offered. The original is not changed."
          : "This kind of file cannot be repaired; carving can still pull out pictures and documents inside it."}
      </span>
    {/if}
    {#if failure !== null}
      <Badge variant="danger">{failure}</Badge>
    {/if}
  </div>
</div>
