<script lang="ts">
  /*
   * Text Recognition: the pages, whether each already had text or was read, and the text itself.
   *
   * Nothing runs until it is asked for, because recognition sends the file to the firm's
   * recognition engine (the request answers and keeps nothing). Each page says whether it already
   * carried text, was recognized, or was read with low confidence, and choosing a page shows its
   * text beside the list so it can be checked against the picture in the preview. The result is
   * either a searchable PDF (the same pages with an invisible text layer, for a PDF) or the text on
   * its own.
   */
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import FileText from "@lucide/svelte/icons/file-text";
  import ScanText from "@lucide/svelte/icons/scan-text";
  import Type from "@lucide/svelte/icons/type";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { problemGuidance } from "$lib/documents/document-presentation.ts";
  import type { ApiOutcome } from "$lib/api/request.ts";
  import { saveToTarget } from "$lib/export/save-target.ts";
  import Absence from "../parts/absence.svelte";
  import { recognizeText, searchablePdf, type Recognition } from "../file-tools-api.ts";
  import {
    PAGE_READING_LABEL,
    documentText,
    markedName,
    pageReading,
    pageText,
  } from "../file-tools-reading.ts";
  import { isPdf } from "../file-facts.ts";
  import type { CapabilityPanelProps } from "../capability.ts";

  let { file, onAddFiles }: CapabilityPanelProps = $props();

  let recognition = $state<Recognition | null>(null);
  let chosenPage = $state(0);
  let busy = $state<"recognizing" | "layering" | null>(null);
  let failure = $state<string | null>(null);

  $effect(() => {
    void file;
    recognition = null;
    chosenPage = 0;
    failure = null;
  });

  const pdf = $derived(isPdf(file));
  const chosen = $derived(recognition?.pages.find((page) => page.pageIndex === chosenPage) ?? null);
  const anyLowConfidence = $derived(
    recognition?.pages.some((page) => pageReading(page) === "low-confidence") ?? false,
  );

  function failureOf(outcome: Exclude<ApiOutcome<unknown>, { kind: "ok" }>): string {
    if (outcome.kind === "transport") return "Couldn't connect. Nothing was read.";
    if (outcome.problem.status === 503) return "The recognition engine is not running yet.";
    if (outcome.problem.status === 413) return "This file is larger than the recognition engine takes.";
    if (outcome.problem.status === 422) return "The engine could not read this file.";
    return problemGuidance(outcome.problem).message;
  }

  async function recognize(): Promise<void> {
    busy = "recognizing";
    failure = null;
    try {
      const outcome = await recognizeText(fetch, await file.readBytes());
      if (outcome.kind === "ok") {
        recognition = outcome.value;
        chosenPage = outcome.value.pages[0]?.pageIndex ?? 0;
      } else {
        failure = failureOf(outcome);
      }
    } finally {
      busy = null;
    }
  }

  async function layeredCopy(): Promise<File | null> {
    busy = "layering";
    failure = null;
    try {
      const outcome = await searchablePdf(fetch, await file.readBytes());
      if (outcome.kind !== "ok") {
        failure = failureOf(outcome);
        return null;
      }
      return new File([outcome.value], markedName(file.name, "searchable", "pdf"), { type: "application/pdf" });
    } finally {
      busy = null;
    }
  }

  async function saveSearchable(): Promise<void> {
    const copy = await layeredCopy();
    if (copy !== null) await saveToTarget(copy, copy.name, copy.type);
  }

  async function benchSearchable(): Promise<void> {
    if (onAddFiles === undefined) return;
    const copy = await layeredCopy();
    if (copy !== null) onAddFiles([copy]);
  }

  async function saveText(): Promise<void> {
    if (recognition === null) return;
    const text = new Blob([documentText(recognition.pages)], { type: "text/plain;charset=utf-8" });
    await saveToTarget(text, markedName(file.name, "text", "txt"), "text/plain");
  }
</script>

<div class="@container flex flex-col gap-24">
  {#if recognition === null}
    <Absence kind="not-run" reason="Not read yet." />
  {:else if recognition.pages.length === 0}
    <Absence kind="not-applicable" reason="The engine found no pages in this file." />
  {:else}
    <div class="grid items-start gap-16 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <DataTable.Root class="w-full">
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Page</DataTable.Head>
            <DataTable.Head>Text</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each recognition.pages as page (page.pageIndex)}
            {@const reading = PAGE_READING_LABEL[pageReading(page)]}
            <DataTable.Row data-state={page.pageIndex === chosenPage ? "selected" : undefined}>
              <DataTable.Cell class="tabular-nums">
                <button
                  type="button"
                  class="w-full cursor-pointer text-left"
                  aria-pressed={page.pageIndex === chosenPage}
                  onclick={() => (chosenPage = page.pageIndex)}
                >
                  {page.pageIndex + 1}
                </button>
              </DataTable.Cell>
              <DataTable.Cell><Badge variant={reading.tone}>{reading.label}</Badge></DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>

      <DataTable.Root class="w-full">
        <DataTable.Header>
          <DataTable.Row><DataTable.Head>Text, Page {chosenPage + 1}</DataTable.Head></DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          <DataTable.Row>
            <DataTable.Cell class="mc-scrollbar max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
              {#if chosen === null || chosen.lines.length === 0}
                <span class="text-text-muted">
                  {chosen !== null && pageReading(chosen) === "already-text"
                    ? "This page already carries selectable text, so it was not read again."
                    : "No text was read on this page."}
                </span>
              {:else}
                {pageText(chosen)}
              {/if}
            </DataTable.Cell>
          </DataTable.Row>
        </DataTable.Body>
      </DataTable.Root>
    </div>
  {/if}

  <div class="flex flex-wrap items-center gap-16 border-t border-border-default pt-16">
    {#if recognition === null}
      <Button variant="primary" size="sm" disabled={busy !== null} onclick={recognize}>
        <ScanText class="size-16" aria-hidden="true" />
        {busy === "recognizing" ? "Reading the Text" : "Recognize the Text"}
      </Button>
    {:else}
      {#if pdf}
        <Button variant="primary" size="sm" disabled={busy !== null} onclick={saveSearchable}>
          <FileText class="size-16" aria-hidden="true" />
          {busy === "layering" ? "Making the PDF" : "Save Searchable PDF"}
        </Button>
        {#if onAddFiles !== undefined}
          <Button variant="secondary" size="sm" disabled={busy !== null} onclick={benchSearchable}>
            <FilePlus class="size-16" aria-hidden="true" />
            Put the PDF on the Bench
          </Button>
        {/if}
      {/if}
      <Button variant={pdf ? "secondary" : "primary"} size="sm" disabled={busy !== null} onclick={saveText}>
        <Type class="size-16" aria-hidden="true" />
        Save Text Only
      </Button>
      {#if anyLowConfidence}
        <span class="text-sm text-text-subtle">Pages marked Low Confidence are worth checking against the page.</span>
      {/if}
    {/if}
    {#if failure !== null}
      <Badge variant="danger">{failure}</Badge>
    {/if}
  </div>
</div>
