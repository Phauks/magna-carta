<script lang="ts">
  /*
   * A plain-text document, edited here in the application: one field holding the whole text, and
   * one commit that cuts the next version through the same upload ceremony any other save uses.
   *
   * NOTHING IS SAVED UNTIL SAVE NEW VERSION IS PRESSED. There is no autosave: a version is an
   * immutable record on the matter, and a lawyer decides when one is cut. What the field holds and
   * what the record holds can therefore differ, and the strip above the field says so the whole
   * time they do. Leaving with that difference standing asks first — inside the app through the
   * router, and at the tab's edge through the browser's own question, which is the only one that
   * can still be asked once the page is going.
   *
   * The ceremony reports its stages, and the strip repeats them in the same place at the same
   * height: the row never re-flows when the act begins. Each outcome is stated where the act
   * happened, under the strip, never only in a toast.
   */
  import { beforeNavigate } from "$app/navigation";
  import { onMount } from "svelte";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Textarea from "@magna-carta/design-system/textarea";
  import { SAMPLE_SENTENCE } from "@magna-carta/design-system/loading-fixtures";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { fileDownloadUrl, type MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import type { CreationOutcome, CreationStage } from "./create-document.ts";
  import { formatDocumentSize, problemGuidance } from "./document-presentation.ts";
  import { TEXT_EDITOR_MAX_BYTES } from "./editable-documents.ts";
  import { readTextDocument, saveTextDocument } from "./text-document.ts";

  let { file }: { file: MatterFile } = $props();

  // The field's own classes: the surface runs edge to edge under the strip, so the field wears no
  // corner, no border and no resize grip of its own, and reads in the monospace face a plain-text
  // document is written in.
  const FIELD_CLASS = "min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-sm";

  // What the strip says for each stage of the ceremony. A stage this ceremony never enters
  // (assembling belongs to template assembly) still needs a word, so the fallback is the act.
  const STAGE_WORDS: Partial<Record<CreationStage, string>> = {
    reserving: "Reserving a version",
    uploading: "Uploading",
    committing: "Committing",
    scanning: "Checking",
  };

  let text = $state("");
  // The text as the record holds it: null until the read lands, so "not read yet" and "an empty
  // document" cannot be confused.
  let savedText = $state<string | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  /**
   * Why this editor will not open the document, when it will not. Two documents reach it — one too
   * big to hold, one whose bytes are not UTF-8 text — and both end the same way for the reader: the
   * editor stands aside and offers the download. One state, so they cannot drift into two shapes.
   */
  let refusal = $state<{ title: string; description: string } | null>(null);
  let saveStage = $state<CreationStage | null>(null);
  let saveOutcome = $state<CreationOutcome | null>(null);
  // How many versions this surface has cut since it opened, so the version the record is on can be
  // stated without a re-read.
  let versionsSaved = $state(0);

  const reading = $derived(savedText === null && readFailure === null && refusal === null);
  const dirty = $derived(savedText !== null && text !== savedText);
  const saving = $derived(saveStage !== null && saveStage !== "settled");
  const versionNumber = $derived(file.versionNumber + versionsSaved);
  const statusWord = $derived.by((): string => {
    if (saving && saveStage !== null) return STAGE_WORDS[saveStage] ?? "Saving";
    if (dirty) return "Unsaved changes";
    if (saveOutcome !== null && saveOutcome.kind === "created") {
      return `Saved as version ${versionNumber}`;
    }
    return "";
  });

  /** Read the document's current text. Retry asks again for the same document. */
  async function read(): Promise<void> {
    savedText = null;
    readFailure = null;
    refusal = null;
    const outcome = await readTextDocument(fetch, file.id, file.sizeBytes);
    if (outcome.kind === "ok") {
      text = outcome.text;
      savedText = outcome.text;
      return;
    }
    if (outcome.kind === "too-large") {
      refusal = {
        title: "This Document Is Larger Than the Editor Holds",
        description:
          `It's ${formatDocumentSize(outcome.sizeBytes)}; the editor opens up to ${formatDocumentSize(TEXT_EDITOR_MAX_BYTES)}. Download it to work on it.`,
      };
      return;
    }
    if (outcome.kind === "not-text") {
      // Deliberately not opened as best-effort text. A document in a legacy encoding would come
      // back with every accented character replaced, and saving it would write that loss into a new
      // version of a legal record.
      refusal = {
        title: "This Document Is Not Text This Editor Can Open",
        description:
          "This file isn't plain UTF-8 text, so editing it here could corrupt some characters. Download it and open it in the app it was made in.",
      };
      return;
    }
    readFailure = stated(
      outcome.failure,
      "The document could not be read.",
      "Couldn't connect while reading the document.",
    );
  }

  async function save(): Promise<void> {
    if (!dirty || saving) return;
    // The text as it stood when Save was pressed: what lands on the record is exactly this, even if
    // the reader keeps typing while the ceremony runs.
    const submitted = text;
    saveOutcome = null;
    saveStage = "reserving";
    const outcome = await saveTextDocument({
      fetchImpl: fetch,
      matterId: file.matterId,
      fileId: file.id,
      fileName: file.name,
      text: submitted,
      onStage: (stage) => (saveStage = stage),
    });
    saveStage = "settled";
    if (outcome.kind === "created") {
      savedText = submitted;
      versionsSaved += 1;
    }
    saveOutcome = outcome;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    void save();
  }

  // Inside the app the router asks; a full unload is left to the browser's own question below,
  // which is the only one that can still be asked once the page is going.
  beforeNavigate((navigation) => {
    if (!dirty || navigation.willUnload) return;
    if (!confirm("Leave without saving? The changes since the last saved version will be lost.")) {
      navigation.cancel();
    }
  });

  function askBeforeUnload(event: BeforeUnloadEvent): void {
    if (!dirty) return;
    event.preventDefault();
    // Older engines read a string off the event; modern ones show their own words either way.
    event.returnValue = "";
  }

  onMount(() => {
    void read();
    window.addEventListener("beforeunload", askBeforeUnload);
    return () => window.removeEventListener("beforeunload", askBeforeUnload);
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex min-h-0 flex-1 flex-col">
  {#if refusal !== null}
    <div class="p-24">
      <Alert.Root variant="warning">
        <Alert.Title>{refusal.title}</Alert.Title>
        <Alert.Description>{refusal.description}</Alert.Description>
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
  {:else}
    <!-- The strip sits flush under the header, one row with the act at its inline end. The status
         word is always mounted, empty when there is nothing to say, so the row holds one height. -->
    <div class="flex flex-none items-center gap-12 border-b border-border-default px-8 py-4">
      <span class="ms-auto text-sm text-text-muted" role="status" aria-live="polite">{statusWord}</span>
      <Button disabled={!dirty || saving} onclick={save}>Save New Version</Button>
    </div>

    {#if saveOutcome !== null && saveOutcome.kind !== "created"}
      <div class="flex-none p-12">
        {#if saveOutcome.kind === "rejected"}
          <Alert.Root variant="danger">
            <Alert.Title>The Saved Bytes Were Rejected</Alert.Title>
            <Alert.Description>
              {saveOutcome.reason ?? "The check refused them."} The document's current version is
              unchanged.
            </Alert.Description>
          </Alert.Root>
        {:else if saveOutcome.kind === "still-settling"}
          <Alert.Root variant="info">
            <Alert.Title>Still Being Checked</Alert.Title>
            <Alert.Description>
              The bytes landed and the check has not finished. The version appears once it does.
            </Alert.Description>
          </Alert.Root>
        {:else if saveOutcome.kind === "transport"}
          <Alert.Root variant="danger">
            <Alert.Title>Nothing Answered</Alert.Title>
            <Alert.Description>The bytes did not reach the server. Nothing was saved.</Alert.Description>
          </Alert.Root>
        {:else}
          {@const guidance = problemGuidance(saveOutcome.problem)}
          <Alert.Root variant={guidance.tone}>
            <Alert.Title>{guidance.title}</Alert.Title>
            <Alert.Description>{guidance.message}</Alert.Description>
          </Alert.Root>
        {/if}
      </div>
    {/if}

    <LoadingRegion
      loading={reading}
      failed={readFailure !== null}
      label="Reading the document"
      onRetry={read}
      class="flex min-h-0 flex-1 flex-col"
    >
      {#snippet failure()}
        {#if readFailure !== null}
          <div class="p-24">
            <FailureNotice
              failure={readFailure.failure}
              subject="The document"
              fallback={readFailure.fallback}
              whenSilent={readFailure.whenSilent}
              onRetry={read}
            />
          </div>
        {/if}
      {/snippet}
      {#snippet fixture()}
        <Textarea class={FIELD_CLASS} value={SAMPLE_SENTENCE} readonly aria-label="Document text" />
      {/snippet}
      <Textarea
        bind:value={text}
        class={FIELD_CLASS}
        spellcheck={false}
        aria-label="Document text"
      />
    </LoadingRegion>
  {/if}
</div>
