<script lang="ts">
  /*
   * The matter's documents — the whole loop on one screen: see what is on the matter, put something
   * new on it, open one, save the next version of it, and read its version history.
   *
   * Every row here is the firm's own record, read from the file API. The one exception is a SAMPLE
   * matter (the in-repo fixtures the chrome's lifecycle states are reviewed against), which has no
   * firm behind it and therefore no documents to read — that case says so rather than showing an
   * empty table, because "no documents" and "not a real matter" are different facts.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Plus from "@lucide/svelte/icons/plus";
  import { listMatterDocuments, type DocumentSummary } from "$lib/documents/document-api.ts";
  import {
    documentStatusPresentation,
    documentsNewestFirst,
    formatDocumentSize,
    formatDocumentTimestamp,
    problemGuidance,
  } from "$lib/documents/document-presentation.ts";
  import DocumentDetailPanel from "$lib/documents/document-detail-panel.svelte";
  import NewDocumentDialog from "$lib/documents/new-document-dialog.svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  let documents = $state<readonly DocumentSummary[] | null>(null);
  let loadFailure = $state<string | null>(null);
  let selectedDocumentId = $state<string | null>(null);
  let createOpen = $state(false);
  // Bumped to force a re-read after a document lands or gains a version.
  let reloadToken = $state(0);

  $effect(() => {
    const matterId = matter.id;
    const token = reloadToken;
    if (isSample) {
      documents = [];
      return;
    }
    let cancelled = false;
    void (async () => {
      // `token` is read so this re-runs when it changes; nothing else needs its value.
      void token;
      const result = await listMatterDocuments(fetch, matterId);
      if (cancelled) return;
      if (result.kind === "ok") {
        documents = documentsNewestFirst(result.value.data);
        loadFailure = null;
      } else if (result.kind === "transport") {
        documents = [];
        loadFailure = "Nothing answered. The documents on this matter could not be read.";
      } else {
        documents = [];
        loadFailure = problemGuidance(result.problem).message;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const selectedDocument = $derived(
    (documents ?? []).find((candidate) => candidate.id === selectedDocumentId) ?? null,
  );

  function reload(): void {
    reloadToken += 1;
  }

  function openCreated(fileId: string): void {
    selectedDocumentId = fileId;
    reload();
  }

  function toggleSelection(id: string): void {
    selectedDocumentId = selectedDocumentId === id ? null : id;
  }
</script>

<svelte:head>
  <title>Files · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex flex-col gap-16">
  <div class="flex flex-wrap items-center justify-between gap-8 border-b border-border-strong pb-8">
    <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      Files
    </h2>
    {#if !isSample}
      <Button size="sm" onclick={() => (createOpen = true)}>
        <Plus class="size-16" aria-hidden="true" />
        Add a document
      </Button>
    {/if}
  </div>

  {#if isSample}
    <Alert.Root variant="info">
      <Alert.Title>This is a sample matter.</Alert.Title>
      <Alert.Description>
        It exists so the matter screens stay reviewable at a stable address; there is no firm record
        behind it, so it holds no documents and nothing can be added to it. Open one of the firm's
        own matters to use this surface.
      </Alert.Description>
    </Alert.Root>
  {:else if loadFailure !== null}
    <Alert.Root variant="warning">
      <Alert.Title>The documents could not be read.</Alert.Title>
      <Alert.Description>{loadFailure}</Alert.Description>
    </Alert.Root>
  {:else if documents === null}
    <Skeleton class="h-64 w-full" />
  {:else if documents.length === 0}
    <EmptyState title="No documents yet">
      Every document the firm holds for this matter lands here — each version kept, each byte's
      integrity recorded. Add one from a file you have, or build one from a template.
    </EmptyState>
  {:else}
    <div class="overflow-x-auto">
      <DataTable.Root>
        <DataTable.Caption class="sr-only">Files on this matter</DataTable.Caption>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Name</DataTable.Head>
            <DataTable.Head>Status</DataTable.Head>
            <DataTable.Head data-align="end">Version</DataTable.Head>
            <DataTable.Head data-align="end">Size</DataTable.Head>
            <DataTable.Head>Updated</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each documents as document (document.id)}
            {@const status = documentStatusPresentation(document)}
            <DataTable.Row>
              <DataTable.Cell>
                <button
                  type="button"
                  class="inline-flex items-center gap-8 underline underline-offset-2"
                  aria-expanded={selectedDocumentId === document.id}
                  aria-controls="matter-document-detail"
                  onclick={() => toggleSelection(document.id)}
                >
                  <FileIcon
                    contentType={document.sniffedContentType ?? undefined}
                    fileName={document.name}
                    class="size-16"
                  />
                  {document.name}
                </button>
              </DataTable.Cell>
              <DataTable.Cell>
                {#if status === null}
                  <span class="text-text-muted">Ready</span>
                {:else}
                  <Badge variant={status.variant}>{status.label}</Badge>
                  {#if status.detail !== null}
                    <span class="block text-xs text-text-muted">{status.detail}</span>
                  {/if}
                {/if}
              </DataTable.Cell>
              <DataTable.Cell data-align="end">{document.versionNumber}</DataTable.Cell>
              <DataTable.Cell data-align="end">
                {formatDocumentSize(document.sizeBytes)}
              </DataTable.Cell>
              <DataTable.Cell>{formatDocumentTimestamp(document.updatedAt)}</DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    </div>
  {/if}

  {#if selectedDocument !== null}
    <section
      id="matter-document-detail"
      class="flex flex-col gap-16 rounded-md border border-border-default bg-surface-raised p-16"
    >
      <div class="flex flex-wrap items-center justify-between gap-8">
        <h3 class="text-lg font-semibold">{selectedDocument.name}</h3>
        <Button variant="ghost" size="sm" onclick={() => (selectedDocumentId = null)}>Close</Button>
      </div>
      <DocumentDetailPanel document={selectedDocument} onVersionSaved={reload} />
    </section>
  {/if}
</section>

{#if !isSample}
  <NewDocumentDialog bind:open={createOpen} matterId={matter.id} onCreated={openCreated} />
{/if}
