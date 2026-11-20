<script lang="ts">
  /*
   * The PDF Editor: the one place a PDF on a matter is changed on its pages. Each tool is a tab
   * over the same document. The header and the way back are the reader's own, so moving between
   * reading a document and working on it never changes where the reader stands.
   *
   * No tool overwrites what someone may already rely on. Redacting, extracting and splitting make NEW
   * files beside the original; arranging the pages saves the next VERSION, which keeps the version
   * before it in the file's history.
   */
  import { invalidateAll } from "$app/navigation";
  import BookOpen from "@lucide/svelte/icons/book-open";
  import Button from "@magna-carta/design-system/button";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { viewerHref } from "$lib/documents/editable-documents.ts";
  import { formatDocumentSize } from "$lib/documents/document-presentation.ts";
  import { matterSubject } from "$lib/pdf-editor/editor-subject.ts";
  import PdfEditorTabs from "$lib/pdf-editor/pdf-editor-tabs.svelte";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { matterFilesBack } from "$lib/screen/screen-header.ts";
  import type { DocumentViewPageData } from "../view/+page.ts";

  let { data }: { data: DocumentViewPageData } = $props();

  const file = $derived(data.file ?? null);
  const filesBack = $derived(
    file === null ? null : matterFilesBack(file.matterId, data.matter?.title ?? "Files", file.id),
  );

  let tool = $state("pages");
</script>

<svelte:head>
  <title>{file === null ? "PDF Editor" : `Edit ${file.name}`} · Magna Carta</title>
</svelte:head>

{#if data.failure !== undefined}
  <ScreenHeader title="PDF Editor" class="mb-24" />
  <FailureNotice
    failure={data.failure}
    subject="The document"
    fallback="Couldn't load the document."
    whenSilent="Couldn't connect while reading the document."
    onRetry={() => void invalidateAll()}
  />
{:else if file !== null && filesBack !== null}
  <div class="flex min-h-full flex-col">
    <ScreenHeader title={file.name} back={filesBack} class="mb-16 flex-none">
      {#snippet meta()}
        <span>Version {file.versionNumber}</span>
        <Masthead.MetaSeparator />
        <span>{formatDocumentSize(file.sizeBytes)}</span>
      {/snippet}
      {#snippet actions()}
        <Button variant="secondary" size="sm" href={viewerHref(file.id)}>
          <BookOpen class="size-16" aria-hidden="true" />
          Read
        </Button>
      {/snippet}
    </ScreenHeader>

    <PdfEditorTabs
      subject={matterSubject(file)}
      bind:tool
      reopenKey={file.versionNumber}
      onSaved={() => void invalidateAll()}
    />
  </div>
{/if}
