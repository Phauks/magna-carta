<script lang="ts">
  /*
   * The PDF Editor: the one place a PDF on a matter is changed on its pages. Each tool is a tab
   * over the same document. The header and the way back are the reader's own, so moving between
   * reading a document and working on it never changes where the reader stands.
   *
   * Every tool makes a NEW file beside the original rather than overwriting it, because a court
   * filing, a production and a client copy are each a document someone may already rely on.
   */
  import { invalidateAll } from "$app/navigation";
  import BookOpen from "@lucide/svelte/icons/book-open";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Button from "@magna-carta/design-system/button";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import FullHeightSection from "$lib/components/full-height-section.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { viewerHref } from "$lib/documents/editable-documents.ts";
  import { formatDocumentSize } from "$lib/documents/document-presentation.ts";
  import RedactTool from "$lib/pdf-editor/redact-tool.svelte";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { matterFilesBack } from "$lib/screen/screen-header.ts";
  import type { DocumentViewPageData } from "../view/+page.ts";

  let { data }: { data: DocumentViewPageData } = $props();

  const file = $derived(data.file ?? null);
  const filesBack = $derived(
    file === null ? null : matterFilesBack(file.matterId, data.matter?.title ?? "Files", file.id),
  );

  let tool = $state("redact");
</script>

<svelte:head>
  <title>{file === null ? "PDF Editor" : `Edit ${file.name}`} · Magna Carta</title>
</svelte:head>

{#if data.failure !== undefined}
  <ScreenHeader title="PDF Editor" class="mb-24" />
  <FailureNotice
    failure={data.failure}
    subject="The document"
    fallback="The document could not be read."
    whenSilent="Nothing answered when the document was read."
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

    <Tabs.Root bind:value={tool} class="flex-none">
      <Tabs.List aria-label="PDF tools">
        <Tabs.Trigger value="redact">
          <EyeOff class="size-16" aria-hidden="true" />
          Redact
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>

    <FullHeightSection class="-mx-24 flex flex-col border-t border-border-default">
      {#if tool === "redact"}
        <RedactTool {file} />
      {/if}
    </FullHeightSection>
  </div>
{/if}
