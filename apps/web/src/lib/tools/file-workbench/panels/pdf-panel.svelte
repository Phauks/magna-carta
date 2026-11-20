<script lang="ts">
  /*
   * PDF: what this PDF is, and the PDF Editor's tools.
   *
   * Read as the tab opens, in a worker, by the firm's own engine (`summarize` in
   * `$lib/pdf-editor/pdf-operations.worker.ts`): the pages and their size, the form, the password,
   * and the Bates labels already on the pages. Only the counts and the labels come back; the pages'
   * text stays in the worker.
   *
   * Each tool's Open hands this file to the PDF Editor, drawn over the bench by the route, and what
   * the editor makes comes back here as a new file. A tool that cannot work on a bench file stays
   * listed, shut, with its reason where its description would be.
   */
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import LockOpen from "@lucide/svelte/icons/lock-open";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { describeOperationFailure, runPdfOperation } from "$lib/pdf-editor/pdf-operations.ts";
  import type { PdfSummary } from "$lib/pdf-editor/pdf-summary.ts";
  import Absence from "../parts/absence.svelte";
  import FactTable, { type Fact } from "../parts/fact-table.svelte";
  import { capabilityById } from "../capabilities.ts";
  import {
    describeBates,
    describeForm,
    describePages,
    describeProtection,
    toolRowsFor,
  } from "../pdf-reading.ts";
  import type { CapabilityPanelProps } from "../capability.ts";

  let { file, onOpenCapability, onOpenPdfEditor }: CapabilityPanelProps = $props();

  type Reading =
    | { readonly kind: "reading" }
    | { readonly kind: "read"; readonly summary: PdfSummary }
    | { readonly kind: "failed"; readonly message: string };

  let reading = $state<Reading>({ kind: "reading" });

  // A different file starts from nothing: a reading belongs to the bytes it was made from.
  $effect(() => {
    const target = file;
    reading = { kind: "reading" };
    let current = true;
    void (async () => {
      let bytes: Uint8Array;
      try {
        bytes = await target.readBytes();
      } catch {
        if (current) reading = { kind: "failed", message: "This file is no longer on the bench." };
        return;
      }
      const reply = await runPdfOperation(bytes.slice().buffer, { kind: "summarize" });
      if (!current) return;
      if (reply.kind === "failed") {
        reading = { kind: "failed", message: describeOperationFailure(reply.reason, reply.message) };
      } else if (reply.summary === undefined) {
        reading = { kind: "failed", message: describeOperationFailure("unsupported", "") };
      } else {
        reading = { kind: "read", summary: reply.summary };
      }
    })();
    return () => {
      current = false;
    };
  });

  const summary = $derived(reading.kind === "read" ? reading.summary : null);
  const locked = $derived(summary?.needsPassword === true);
  const unlock = capabilityById("unlock");

  const facts = $derived.by((): Fact[] => {
    if (summary === null) {
      return ["Pages", "Form", "Password", "Bates labels"].map((label) => ({ label, value: "Reading" }));
    }
    const protection = describeProtection(summary);
    if (summary.needsPassword) {
      const unread = "Not read until it's unlocked";
      return [
        { label: "Pages", value: unread },
        { label: "Form", value: unread },
        { label: "Password", value: protection.value, tone: "warning" },
        { label: "Bates labels", value: unread },
      ];
    }
    const bates = describeBates(summary.bates, summary.pages.length);
    return [
      { label: "Pages", value: describePages(summary.pages) },
      { label: "Form", value: describeForm(summary.form) },
      { label: "Password", ...protection },
      { label: "Bates labels", ...bates },
    ];
  });

  const rows = $derived(toolRowsFor(summary));
</script>

{#snippet open(tool: string, label: string, shut: boolean)}
  <Button
    variant="secondary"
    size="sm"
    disabled={shut}
    aria-label={`Open ${label} in the PDF Editor`}
    onclick={() => onOpenPdfEditor?.(file, tool)}
  >
    <ExternalLink class="size-16" aria-hidden="true" />
    Open
  </Button>
{/snippet}

<div class="@container flex flex-col gap-16">
  {#if reading.kind === "failed"}
    <Absence kind="failed" reason={reading.message} />
  {:else}
    <FactTable title="This PDF" {facts} />
  {/if}

  <DataTable.Root class="w-full">
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head colspan={3}>Tools</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each rows as row (row.tool.id)}
        {@const shut = locked || !row.availability.available || onOpenPdfEditor === undefined}
        {@const quiet = locked || !row.availability.available}
        <DataTable.Row>
          <DataTable.Cell class="@lg:w-px @lg:whitespace-nowrap">
            <span class="flex items-center gap-8">
              <row.tool.icon class="size-16" aria-hidden="true" />
              {row.tool.label}
            </span>
            <!-- On a narrow panel the row is one column: the description is its second line and
                 Open sits under it, rather than three columns the panel cannot hold. -->
            <span class="mt-4 flex flex-col items-start gap-8 @lg:hidden">
              <span class="text-sm text-text-muted">{row.description}</span>
              {@render open(row.tool.id, row.tool.label, shut)}
            </span>
          </DataTable.Cell>
          <DataTable.Cell class="hidden @lg:table-cell {quiet ? 'text-text-muted' : ''}">
            {row.description}
          </DataTable.Cell>
          <DataTable.Cell class="hidden w-px text-end @lg:table-cell">
            {@render open(row.tool.id, row.tool.label, shut)}
          </DataTable.Cell>
        </DataTable.Row>
      {/each}
    </DataTable.Body>
  </DataTable.Root>

  <div class="flex flex-wrap justify-end gap-8">
    {#if locked && unlock !== null && onOpenCapability !== undefined}
      <Button variant="secondary" onclick={() => onOpenCapability(unlock)}>
        <LockOpen class="size-16" aria-hidden="true" />
        Unlock
      </Button>
    {/if}
    <Button
      disabled={locked || onOpenPdfEditor === undefined}
      onclick={() => onOpenPdfEditor?.(file, "pages")}
    >
      <ExternalLink class="size-16" aria-hidden="true" />
      Open in PDF Editor
    </Button>
  </div>
</div>
