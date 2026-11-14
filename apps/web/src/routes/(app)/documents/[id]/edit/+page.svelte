<script lang="ts">
  /*
   * One document, open for editing. THE EDITOR IS THE WHOLE SCREEN: the load declares `shell:
   * "none"`, the app layout draws no rail and no top bar, and this page draws no header — no way
   * back, no name, no version line — so the editor takes the viewport and keeps it (the owner's
   * direction, 2026-09-17). What a member does on the platform from inside the document is the
   * editor's own controls, added to its bar through its message protocol: the way back is the
   * back-to-matter button the office editor inserts, handed the same destination the header used
   * to carry. Which editor is decided by what the file IS (editable-documents.ts),
   * the same decision the file manager made when it opened this address.
   *
   * Two documents get no editor here and say so instead, with the shell and the header around the
   * message because a message needs its way back: a format neither editor takes (reachable only by
   * typing the address, since the file manager never opens one here), which offers the download
   * instead; and a file withheld while a safety finding is open, which offers nothing — the file
   * manager's Safety tab carries the finding.
   */
  import { invalidateAll } from "$app/navigation";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import FullHeightSection from "$lib/components/full-height-section.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import OfficeDocumentEditor from "$lib/documents/office-document-editor.svelte";
  import TextDocumentEditor from "$lib/documents/text-document-editor.svelte";
  import { editorKindOf } from "$lib/documents/editable-documents.ts";
  import { formatDocumentSize, formatDocumentTimestamp } from "$lib/documents/document-presentation.ts";
  import { fileDownloadUrl } from "$lib/file-manager/matter-file-api.ts";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { matterFilesBack } from "$lib/screen/screen-header.ts";
  import type { DocumentEditPageData } from "./+page.ts";

  let { data }: { data: DocumentEditPageData } = $props();

  const file = $derived(data.file ?? null);
  const filesBack = $derived(
    file === null ? null : matterFilesBack(file.matterId, data.matter?.title ?? "Files", file.id),
  );
  const editorKind = $derived(file === null ? null : editorKindOf(file));
  const withheld = $derived(file !== null && file.scanVerdict === "flagged");
</script>

<svelte:head>
  <title>{file === null ? "Document" : file.name} · Magna Carta</title>
</svelte:head>

{#if data.failure !== undefined}
  <ScreenHeader title="Document" class="mb-24" />
  <FailureNotice
    failure={data.failure}
    subject="The document"
    fallback="The document could not be read."
    whenSilent="Couldn't connect while reading the document."
    onRetry={() => void invalidateAll()}
  />
{:else if file !== null && data.shell === "none" && editorKind !== null}
  <!-- The editor alone: the layout's shell-less column is the viewport, and the editor fills it.
       Nothing else is drawn on purpose; the way back is a button the editor draws for us. -->
  <div class="flex h-full min-h-0 flex-col">
    {#if editorKind === "office"}
      <OfficeDocumentEditor
        {file}
        back={filesBack === null
          ? null
          : { ...filesBack, number: data.matter?.matterNumber ?? null }}
      />
    {:else}
      <TextDocumentEditor {file} />
    {/if}
  </div>
{:else if file !== null && filesBack !== null}
  <!-- The matter chrome's own arrangement: a full-height flex column, so the editor below can take
       exactly the remaining viewport height. The header is flex-none so it never gives way. -->
  <div class="flex min-h-full flex-col">
    <ScreenHeader title={file.name} back={filesBack} class="mb-24 flex-none">
      {#snippet meta()}
        <span>Version {file.versionNumber}</span>
        <Masthead.MetaSeparator />
        <span>{formatDocumentSize(file.sizeBytes)}</span>
        <Masthead.MetaSeparator />
        <span>{formatDocumentTimestamp(file.updatedAt)}</span>
      {/snippet}
    </ScreenHeader>

    {#if withheld}
      <Alert.Root variant="warning">
        <Alert.Title>This File Is Withheld While a Finding Is Open</Alert.Title>
        <Alert.Description>See the file's Safety tab for details.</Alert.Description>
      </Alert.Root>
    {:else if editorKind === null}
      <Alert.Root variant="info">
        <Alert.Title>This Format Has No Editor Here</Alert.Title>
        <Button
          variant="secondary"
          size="sm"
          class="self-start"
          href={fileDownloadUrl(file.id)}
          {...opensBeside("file")}
        >
          Download
        </Button>
      </Alert.Root>
    {:else}
      <!-- Edge to edge: the horizontal margins cancel the work canvas's padding, so the editor
           runs to the canvas's edges like the file manager's list does. -->
      <FullHeightSection class="-mx-24">
        {#if editorKind === "office"}
          <OfficeDocumentEditor {file} />
        {:else}
          <TextDocumentEditor {file} />
        {/if}
      </FullHeightSection>
    {/if}
  </div>
{/if}
