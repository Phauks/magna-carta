<script lang="ts">
  /*
   * Matter files — the versioned file record, presented from fixtures so the table teaches
   * the real shape (name, type, version, size, updated). Presentation only; folders, upload,
   * and versioning arrive with the File Manager surface.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import type { MatterFixture } from "$lib/matters/fixtures.ts";

  let { data }: { data: { matter: MatterFixture } } = $props();

  const matter = $derived(data.matter);

  /** Human-readable size: whole bytes below 1 KB, otherwise one decimal at the natural unit. */
  function formatFileSize(sizeBytes: number): string {
    if (sizeBytes < 1024) return `${sizeBytes} B`;
    const kilobytes = sizeBytes / 1024;
    if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
    const megabytes = kilobytes / 1024;
    if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;
    return `${(megabytes / 1024).toFixed(1)} GB`;
  }
</script>

<svelte:head>
  <title>Files · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex flex-col gap-16">
  <h2
    class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    Files
  </h2>

  {#if matter.files.length === 0}
    <EmptyState title="No files yet">
      Every document the firm holds for this matter lands here — each version kept, each byte's
      integrity recorded. Files arrive with the File Manager surface.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">Files on this matter</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Name</DataTable.Head>
          <DataTable.Head>Type</DataTable.Head>
          <DataTable.Head data-align="end">Version</DataTable.Head>
          <DataTable.Head data-align="end">Size</DataTable.Head>
          <DataTable.Head>Updated</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each matter.files as file (file.name)}
          <DataTable.Row>
            <DataTable.Cell>{file.name}</DataTable.Cell>
            <DataTable.Cell>{file.documentType}</DataTable.Cell>
            <DataTable.Cell data-align="end">{file.version}</DataTable.Cell>
            <DataTable.Cell data-align="end">{formatFileSize(file.sizeBytes)}</DataTable.Cell>
            <DataTable.Cell>{DataTable.formatDate(file.updatedAt)}</DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  {/if}
</section>
