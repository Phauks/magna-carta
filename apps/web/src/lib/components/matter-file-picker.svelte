<script lang="ts">
  /*
   * Choosing a file the firm already holds on a matter. The product's ONE of these.
   *
   * WHY IT IS SHARED. Three surfaces had grown their own by the time anybody counted: the conflicts
   * waiver wanted the document evidencing a written consent, custody wanted the scan of an original,
   * and each had its own read, its own failure wording, and its own idea of what a pending or
   * quarantined file should do in a list. They had already drifted on the last one, which is the
   * interesting one: a file the scanner rejected must not silently vanish from a picker, because a
   * person who filed it will go looking for it and conclude the filing failed.
   *
   * SO A FILE THAT IS NOT CLEAN IS OFFERED, AND SAYS WHAT IT IS. It is listed with its state beside
   * it rather than hidden, and a surface that genuinely must not accept one refuses it by name
   * through `selectable` rather than by pretending it does not exist. Hiding is the one treatment
   * that leaves a person unable to tell "not there" from "not allowed".
   *
   * A CHECK WITH NO MATTER CAN OFFER NOTHING, AND SAYS SO. Files are matter-rooted, so a surface
   * that has not chosen a matter yet has nowhere to look. The control renders refused with that
   * reason rather than disappearing.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { listMatterDocuments, type DocumentSummary } from "$lib/documents/document-api.ts";

  let {
    matterId,
    inputId,
    fieldName = "Document",
    disabled = false,
    excluded = [],
    selectable,
    onPick,
  }: {
    /** The matter whose files may be chosen. Null where the surface has no matter yet. */
    matterId: string | null;
    /** The combobox input's id, so a consumer's Label points at it. */
    inputId: string;
    /** What this field is choosing, for the input's own accessible name. */
    fieldName?: string;
    disabled?: boolean;
    /** Files already chosen, so a list never offers a duplicate. */
    excluded?: readonly string[];
    /**
     * Whether a given file may be picked. Absent means any of them may.
     *
     * A refusal here still LISTS the file — the row is drawn with its reason — because a surface
     * that dropped it would be telling a person their file is not there when it is.
     */
    selectable?: (document: DocumentSummary) => string | null;
    onPick: (document: DocumentSummary) => void;
  } = $props();

  let documents = $state<readonly DocumentSummary[]>([]);
  let reading = $state(false);
  let readFailed = $state(false);
  let query = $state("");
  let readMatterId: string | null = null;

  // One read per matter. A read that could not run is stated rather than rendered as a matter
  // holding no files: the two are the same picture and they are not the same fact.
  $effect(() => {
    const matter = matterId;
    if (matter === null) {
      documents = [];
      readMatterId = null;
      return;
    }
    if (readMatterId === matter) return;
    readMatterId = matter;
    reading = true;
    void (async () => {
      const outcome = await listMatterDocuments(fetch, matter);
      if (readMatterId !== matter) return;
      reading = false;
      if (outcome.kind === "ok") {
        documents = outcome.value.data;
        readFailed = false;
        return;
      }
      documents = [];
      readFailed = true;
    })();
  });

  const offered = $derived.by(() => {
    const wanted = query.trim().toLowerCase();
    return documents
      .filter((document) => !excluded.includes(document.id))
      .filter((document) => wanted === "" || document.name.toLowerCase().includes(wanted));
  });

  /** Why this file cannot be chosen, or null. */
  function refusal(document: DocumentSummary): string | null {
    return selectable?.(document) ?? null;
  }

  function pick(value: string | string[]): void {
    const fileId = Array.isArray(value) ? (value[0] ?? "") : value;
    const document = offered.find((candidate) => candidate.id === fileId);
    if (document === undefined || refusal(document) !== null) return;
    onPick(document);
    query = "";
  }
</script>

<Combobox.Root
  type="single"
  disabled={disabled || matterId === null}
  items={offered.map((document) => ({
    value: document.id,
    label: document.name,
    disabled: refusal(document) !== null,
  }))}
  inputValue={query}
  onValueChange={pick}
>
  <Combobox.Input
    id={inputId}
    {fieldName}
    autocomplete="off"
    oninput={(event) => (query = event.currentTarget.value)}
  />
  <Combobox.Content>
    {#each offered as document (document.id)}
      {@const why = refusal(document)}
      <Combobox.Item value={document.id} label={document.name} disabled={why !== null}>
        {document.name}
        {#if why !== null}
          <span class="text-text-muted">&mdash; {why}</span>
        {/if}
      </Combobox.Item>
    {/each}
  </Combobox.Content>
</Combobox.Root>

{#if matterId === null}
  <p class="text-xs text-text-muted">Choose the matter first. Files are filed on one.</p>
{:else if readFailed}
  <p class="text-xs text-text-muted">This matter's file store could not be read.</p>
{:else if reading}
  <p class="text-xs text-text-muted">Reading the matter's files.</p>
{:else if documents.length === 0}
  <p class="text-xs text-text-muted">This matter holds no files yet.</p>
{/if}
