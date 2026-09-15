<script lang="ts">
  /*
   * One document, open for editing — the shell every opened file wears
   * ($lib/documents/document-shell.svelte), with an editor as its interior. Which editor is decided
   * by what the file IS (editable-documents.ts), the same decision the file manager made when it
   * opened this address.
   *
   * Two documents get no editor here and say so in the interior's place: a format neither editor
   * takes (reachable only by typing the address, since the file manager never opens one here), which
   * offers the download instead; and a file withheld while a safety finding is open, which offers
   * nothing — the file manager's Safety tab carries the finding. Neither costs the member the shell:
   * the document is still named, and the way back to its matter is still there.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import DocumentShell from "$lib/documents/document-shell.svelte";
  import OfficeDocumentEditor from "$lib/documents/office-document-editor.svelte";
  import TextDocumentEditor from "$lib/documents/text-document-editor.svelte";
  import { editorKindOf } from "$lib/documents/editable-documents.ts";
  import { fileDownloadUrl } from "$lib/file-manager/matter-file-api.ts";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import type { DocumentEditPageData } from "./+page.ts";

  let { data }: { data: DocumentEditPageData } = $props();

  const file = $derived(data.file ?? null);
  const editorKind = $derived(file === null ? null : editorKindOf(file));
  const withheld = $derived(file !== null && file.scanVerdict === "flagged");
</script>

<DocumentShell {file} matter={data.matter} failure={data.failure}>
  {#if file === null}
    <!-- Unreachable in practice: the load either resolves the file, returns a failure the shell
         states, or throws 404. Stated rather than left blank, because "the shell always draws" is
         only true if every branch through it draws something. -->
    <div class="p-24">
      <Alert.Root variant="info">
        <Alert.Title>This Document Is Not Available</Alert.Title>
        <Alert.Description>Nothing was returned for this address.</Alert.Description>
      </Alert.Root>
    </div>
  {:else if withheld}
    <div class="p-24">
      <Alert.Root variant="warning">
        <Alert.Title>This File Is Withheld While a Finding Is Open</Alert.Title>
        <Alert.Description>The file manager's Safety tab carries the finding.</Alert.Description>
      </Alert.Root>
    </div>
  {:else if editorKind === null}
    <div class="p-24">
      <Alert.Root variant="info">
        <Alert.Title>This Format Has No Editor Here</Alert.Title>
        <Alert.Description>
          Nothing in the application edits this kind of file. Download it and open it in the
          application it was written in.
        </Alert.Description>
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
    </div>
  {:else if editorKind === "office"}
    <OfficeDocumentEditor {file} />
  {:else}
    <TextDocumentEditor {file} />
  {/if}
</DocumentShell>
