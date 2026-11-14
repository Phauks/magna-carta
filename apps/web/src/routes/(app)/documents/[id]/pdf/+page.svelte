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
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import FileText from "@lucide/svelte/icons/file-text";
  import Hash from "@lucide/svelte/icons/hash";
  import Layers from "@lucide/svelte/icons/layers";
  import Signature from "@lucide/svelte/icons/signature";
  import Lock from "@lucide/svelte/icons/lock";
  import Stamp from "@lucide/svelte/icons/stamp";
  import Button from "@magna-carta/design-system/button";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import FullHeightSection from "$lib/components/full-height-section.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { viewerHref } from "$lib/documents/editable-documents.ts";
  import { formatDocumentSize } from "$lib/documents/document-presentation.ts";
  import BatesTool from "$lib/pdf-editor/bates-tool.svelte";
  import FormsTool from "$lib/pdf-editor/forms-tool.svelte";
  import PagesTool from "$lib/pdf-editor/pages-tool.svelte";
  import RedactTool from "$lib/pdf-editor/redact-tool.svelte";
  import SecureTool from "$lib/pdf-editor/secure-tool.svelte";
  import SigningTool from "$lib/pdf-editor/signing-tool.svelte";
  import WatermarkTool from "$lib/pdf-editor/watermark-tool.svelte";
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

    <Tabs.Root bind:value={tool} class="flex-none">
      <Tabs.List aria-label="PDF tools">
        <Tabs.Trigger value="pages">
          <Layers class="size-16" aria-hidden="true" />
          Pages
        </Tabs.Trigger>
        <Tabs.Trigger value="redact">
          <EyeOff class="size-16" aria-hidden="true" />
          Redact
        </Tabs.Trigger>
        <Tabs.Trigger value="forms">
          <FileText class="size-16" aria-hidden="true" />
          Forms
        </Tabs.Trigger>
        <Tabs.Trigger value="bates">
          <Hash class="size-16" aria-hidden="true" />
          Bates
        </Tabs.Trigger>
        <Tabs.Trigger value="watermark">
          <Stamp class="size-16" aria-hidden="true" />
          Watermark
        </Tabs.Trigger>
        <Tabs.Trigger value="secure">
          <Lock class="size-16" aria-hidden="true" />
          Secure
        </Tabs.Trigger>
        <Tabs.Trigger value="signature">
          <Signature class="size-16" aria-hidden="true" />
          Signature
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>

    <FullHeightSection class="-mx-24 flex flex-col border-t border-border-default">
      <!-- A tab is opened afresh on each new version, so it never works from bytes a save replaced. -->
      {#key file.versionNumber}
        {#if tool === "pages"}
          <PagesTool {file} onSaved={() => void invalidateAll()} />
        {:else if tool === "redact"}
          <RedactTool {file} />
        {:else if tool === "forms"}
          <FormsTool {file} onSaved={() => void invalidateAll()} />
        {:else if tool === "bates"}
          <BatesTool {file} />
        {:else if tool === "watermark"}
          <WatermarkTool {file} />
        {:else if tool === "secure"}
          <SecureTool {file} />
        {:else if tool === "signature"}
          <SigningTool {file} />
        {/if}
      {/key}
    </FullHeightSection>
  </div>
{/if}
