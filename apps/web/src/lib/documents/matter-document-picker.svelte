<script lang="ts">
  /*
   * A document picked from the matter's own file store, never typed.
   *
   * The two records that use this — a conflicts waiver's written confirmation, a fee arrangement's
   * signed agreement — are things a firm is asked to PRODUCE, and a note saying where a document
   * might be is not the document. So whatever this returns is a file the platform can hand over on
   * demand. A free-text field here would be the sentence the whole record replaces, wearing a
   * different label.
   *
   * A RECORD WITH NO MATTER CAN FILE NOTHING, AND SAYS SO. Files are matter-rooted, so a surface
   * that names no matter — a pre-consult conflicts check — has nowhere to put the paper. The
   * control renders refused with the caller's own sentence rather than disappearing.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { listMatterDocuments, type DocumentSummary } from "$lib/documents/document-api.ts";

  let {
    value = $bindable(null),
    matterId,
    inputId,
    fieldName,
    noMatterNote,
    noFilesNote,
    chosenNoun,
    disabled = false,
  }: {
    /** The chosen file's handle, or null where none has been chosen. */
    value?: string | null;
    /** The matter whose files may be chosen. Null where the record names no matter. */
    matterId: string | null;
    /** The combobox input's id, so the consumer's Label can point at it. */
    inputId: string;
    /** What the field is called, in the reader's words. */
    fieldName: string;
    /** What to say where there is no matter to file into. */
    noMatterNote: string;
    /** What to say where the matter holds no files yet. */
    noFilesNote: string;
    /** What the chosen file will be recorded as: "the evidencing document", "the signed agreement". */
    chosenNoun: string;
    disabled?: boolean;
  } = $props();
  let documents = $state<readonly DocumentSummary[]>([]);
  let query = $state("");
  let reading = $state(false);
  let readFailed = $state(false);

  // One read per matter, when the field is in play. The list is the matter's own file store, which a
  // reviewer recording a waiver has usually just filed the confirmation into.
  $effect(() => {
    const matter = matterId;
    if (matter === null) {
      documents = [];
      return;
    }
    let live = true;
    reading = true;
    void (async () => {
      const outcome = await listMatterDocuments(fetch, matter);
      if (!live) return;
      reading = false;
      if (outcome.kind === "ok") {
        documents = outcome.value.data;
        readFailed = false;
        return;
      }
      // A read that could not run is stated rather than rendered as a matter holding no files: the
      // two are the same picture and they are not the same fact.
      documents = [];
      readFailed = true;
    })();
    return () => {
      live = false;
    };
  });

  // Filtering is consumer-controlled in this combobox, so the typed query narrows the list here.
  const pickable = $derived(
    query.trim() === ""
      ? documents
      : documents.filter((document) =>
          document.name.toLowerCase().includes(query.trim().toLowerCase()),
        ),
  );
  const chosen = $derived(documents.find((document) => document.id === value) ?? null);

  function choose(picked: string | string[]): void {
    const fileId = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    value = fileId === "" ? null : fileId;
  }
</script>

<Combobox.Root
  type="single"
  disabled={disabled || matterId === null}
  items={pickable.map((document) => ({ value: document.id, label: document.name }))}
  onValueChange={choose}
>
  <Combobox.Input
    id={inputId}
    {fieldName}
    autocomplete="off"
    oninput={(event) => (query = event.currentTarget.value)}
  />
  <Combobox.Content>
    {#each pickable as document (document.id)}
      <Combobox.Item value={document.id} label={document.name}>{document.name}</Combobox.Item>
    {/each}
  </Combobox.Content>
</Combobox.Root>

{#if matterId === null}
  <p class="text-xs text-text-muted">{noMatterNote}</p>
{:else if readFailed}
  <p class="text-xs text-text-muted">The matter's files could not be reached.</p>
{:else if reading}
  <p class="text-xs text-text-muted">Reading the matter's files.</p>
{:else if documents.length === 0}
  <p class="text-xs text-text-muted">{noFilesNote}</p>
{:else if chosen !== null}
  <p class="text-xs text-text-muted">{chosen.name} will be recorded as {chosenNoun}.</p>
{/if}
