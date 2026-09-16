<script lang="ts">
  /*
   * RecordAttachments — the files a record carries, and the one place any kind of record shows them.
   *
   * DETACHING IS NOT DELETING, and every word here is chosen to keep that true. A record and a
   * document are joined; ending the join ends the join, and the document stays exactly where it
   * lives in the matter's files. So the act is called Detach and never Delete or Remove, its glyph
   * is a broken link and never a waste bin, and the confirmation says in as many words where the
   * document will still be afterwards. A reader who thinks they might be destroying evidence will
   * not press the control, and a reader who presses it believing that is a far worse outcome.
   *
   * A RECORD CARRIES AS MANY FILES AS THE WORK PRODUCED. Not one receipt, not one attachment slot:
   * a list, any row of which ends on its own.
   *
   * TWO SOURCES, AND THE MATTER'S OWN DOCUMENTS COME FIRST. Most of the time the file is already
   * filed — it was uploaded when it arrived, and the record is being written about it afterwards —
   * so the first thing offered is a search over what the matter already holds, and picking one
   * POINTS AT it rather than making a second copy of it. Upload is the second source, for the file
   * that is not in the matter yet. A document this record already carries is not offered again.
   *
   * THE SOURCES SIT ABOVE THE LIST, at the top of the pane. They used to sit under it, which put
   * the one control a reader opens the tab for beneath however many files the record already
   * carries, and the picker's list was capped at a height that showed one document at a time —
   * the owner's correction of 2026-09-16 ("attaching items from the matter should be on the top
   * of the right side, i can only see one item at a time"). The picker now takes the height the
   * floating surface has room for, on the combobox viewport's own rule, and the act comes first;
   * what is already attached reads beneath it.
   *
   * The tab is DOMAIN-BLIND. It is the same tab on every kind of record, so nothing here names one:
   * a record hands over its attachments and its verbs, and this presents them.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import FolderSearch from "@lucide/svelte/icons/folder-search";
  import Unlink from "@lucide/svelte/icons/unlink";
  import * as Alert from "../alert/index.ts";
  import ActionDialog from "../action-dialog/action-dialog.svelte";
  import type { ActionOutcome } from "../action-dialog/types.ts";
  import * as Command from "../command/index.ts";
  import * as Popover from "../popover/index.ts";
  import Button from "../button/button.svelte";
  import { buttonClasses } from "../button/variants.ts";
  import Dropzone from "../dropzone/dropzone.svelte";
  import EmptyState from "../empty-state/empty-state.svelte";
  import FileIcon from "../file-icon/file-icon.svelte";
  import Skeleton from "../skeleton/index.ts";
  import {
    formatInstant as instantText,
    instantAttribute,
    type Instant,
  } from "../../formatters/instant.ts";
  import { personName } from "../../formatters/person-name.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import {
    attachableDocumentCount,
    attachableDocumentKeywords,
    unattachedDocumentFolders,
  } from "./attachable-documents.ts";
  import type { AttachableDocument, AttachableDocumentFolder, RecordAttachment } from "./types.ts";

  let {
    attachments,
    canEdit = true,
    attachDisabledReason,
    documentSource = [],
    documentSourceDisabledReason,
    onAttachExisting,
    onAttachUpload,
    onDetach,
    onOpen,
    preview,
    loading = false,
    loadingMessage = "Loading what is attached",
    errorMessage,
    errorIdentifier,
    onRetry,
    formatInstant = instantText,
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** Every file riding this record. The order is the caller's. */
    attachments: readonly RecordAttachment[];
    /** Whether this account may change what is attached. False leaves the controls visible, refused. */
    canEdit?: boolean;
    /**
     * Why attaching and detaching are refused. Given with `canEdit` false, the controls stay where
     * they are and say this instead of disappearing: a control that vanishes leaves a reader
     * wondering whether they missed it, where a refused one tells them what would change the answer.
     */
    attachDisabledReason?: string;
    /**
     * The matter's own documents, grouped by the folder they are filed in. This is what the first
     * source searches; a document already on this record is left out of it.
     */
    documentSource?: readonly AttachableDocumentFolder[];
    /**
     * Why the matter's documents cannot be searched, where that is refused on its own — a record
     * with no matter yet has no files to pick from. Stated beside the refused control.
     */
    documentSourceDisabledReason?: string;
    /** A document already in the matter was picked: point this record at it, do not copy it. */
    onAttachExisting?: (document: AttachableDocument) => void;
    /** Files were chosen or dropped: upload them and attach them. */
    onAttachUpload?: (files: File[]) => void;
    /** End this record's association with the file. The document itself is not touched. */
    onDetach?: (attachment: RecordAttachment) => void;
    /** Open the document. Where it opens is the caller's business, not this tab's. */
    onOpen?: (attachment: RecordAttachment) => void;
    /**
     * A look at what is attached, rendered beneath the list — the receipt beside the charge, for a
     * record whose reader needs to see the file rather than its name.
     */
    preview?: Snippet;
    /** True while the attachments are being fetched: placeholder rows stand in for the real ones. */
    loading?: boolean;
    /** What a screen reader is told while the list is loading. */
    loadingMessage?: string;
    /** Given, the list is replaced by a recoverable failure stating this. */
    errorMessage?: string;
    /** The failure's own reference, so a person reporting it can name the exact one they hit. */
    errorIdentifier?: string;
    /** Try the fetch again. Without it the failure states itself and offers nothing. */
    onRetry?: () => void;
    /**
     * How an attachment's instant is rendered. The default states the actual moment in the reader's
     * local time; an override must do the same, because elapsed time ("2 hours ago") decays while
     * it is being read and cannot be compared between two rows.
     */
    formatInstant?: (at: Instant) => string;
  } = $props();

  /** The record that a press is asking to detach, held until the reader confirms or backs out. */
  let pendingDetach = $state<RecordAttachment | null>(null);
  let searchingDocuments = $state(false);

  const offeredFolders = $derived(unattachedDocumentFolders(documentSource, attachments));
  const offeredCount = $derived(attachableDocumentCount(offeredFolders));
  const canSearchDocuments = $derived(canEdit && documentSourceDisabledReason === undefined);
  /*
   * The list is readable, so what is on offer can be trusted. While the attachments are still
   * arriving nobody knows what this record already carries, and a picker that cannot leave those out
   * would offer a document a second time; a failed fetch has the same problem and its own act to
   * take first.
   */
  const listIsReadable = $derived(!loading && errorMessage === undefined);

  const PLACEHOLDER_ROWS = [0, 1, 2];

  function chooseDocument(chosen: AttachableDocument): void {
    searchingDocuments = false;
    onAttachExisting?.(chosen);
  }

  async function confirmDetach(): Promise<ActionOutcome> {
    const attachment = pendingDetach;
    if (attachment === null) return "refused";
    onDetach?.(attachment);
    // The shell closes the panel; the binding below clears the pending record as it goes.
    return "committed";
  }

  /**
   * What the detach control is called for one row. A refused control keeps its name and adds the
   * reason, so a reader who cannot see it greyed out is told the same thing the pointer is told.
   */
  function detachLabel(attachment: RecordAttachment): string {
    const name = `Detach ${attachment.name}`;
    return canEdit || attachDisabledReason === undefined
      ? name
      : `${name}: ${attachDisabledReason}`;
  }
</script>

<div
  bind:this={ref}
  aria-busy={loading ? "true" : undefined}
  class={mergeClasses("mc-record-attachments", className)}
  {...restProps}
>
  {#if listIsReadable}
    <div class="mc-record-attachments-sources">
      <!--
        The matter's own documents are offered FIRST, because most of the time the file is already
        filed and picking it points at it rather than making a second copy.
      -->
      <Popover.Root bind:open={searchingDocuments}>
        <Popover.Trigger
          disabled={!canSearchDocuments}
          title={canSearchDocuments
            ? undefined
            : (documentSourceDisabledReason ?? attachDisabledReason)}
          class={mergeClasses(
            buttonClasses({ variant: "secondary", size: "default" }),
            "mc-record-attachments-source w-full",
          )}
        >
          <FolderSearch class="mc-record-attachments-source-icon" aria-hidden="true" />
          From the Matter…
        </Popover.Trigger>
        <Popover.Content class="w-sm p-0">
          {#if offeredCount === 0}
            <!--
              Two ways to have nothing on offer, and they call for different sentences: a matter
              with no documents in it at all, and a matter whose documents are all on this record
              already. Telling a reader "no results" for the second one would read as a defect.
            -->
            <p class="mc-record-attachments-picker-note">
              {documentSource.length === 0
                ? "This matter holds no documents yet. Upload one to attach it."
                : "Every document in this matter is already attached to this record."}
            </p>
          {:else}
            <!-- The palette's own border and ground go: the popover surface already carries both. -->
            <Command.Root label="Search this matter's documents" class="border-0 bg-transparent">
              <!--
                The ghost text is the FIELD'S NAME, never an instruction: it disappears the moment
                someone types, which is exactly when an instruction would be needed. The leading
                search glyph is what says the field searches.
              -->
              <Command.Input placeholder="Documents" aria-label="Documents" />
              <!-- As tall as the floating surface has room for, up to a screen of documents — the
                   combobox viewport's own rule. A spacing utility capped this at 64 pixels, which
                   is one row. -->
              <Command.List
                style="max-height: min(var(--bits-floating-available-height, 18rem), 18rem)"
              >
                <Command.Viewport>
                  <Command.Empty>No document matches that search.</Command.Empty>
                  {#each offeredFolders as folder (folder.identifier)}
                    <Command.Group>
                      <Command.GroupHeading>{folder.name}</Command.GroupHeading>
                      <Command.GroupItems>
                        {#each folder.documents as offered (offered.identifier)}
                          <Command.Item
                            value={offered.identifier}
                            keywords={attachableDocumentKeywords(offered, folder)}
                            onSelect={() => chooseDocument(offered)}
                            class="mc-record-attachments-picker-item"
                          >
                            <FileIcon
                              contentType={offered.contentType}
                              fileName={offered.name}
                              class="mc-record-attachments-picker-item-icon"
                            />
                            <span class="mc-record-attachments-picker-item-name">
                              {offered.name}
                            </span>
                          </Command.Item>
                        {/each}
                      </Command.GroupItems>
                    </Command.Group>
                  {/each}
                </Command.Viewport>
              </Command.List>
            </Command.Root>
          {/if}
        </Popover.Content>
      </Popover.Root>

      <!--
        The second source, offered only by a record kind that can actually take an upload. It is the
        shared upload surface rather than a bare button so a file can be dragged onto it as well as
        chosen, and so the control that opens the picker is a real, named input a keyboard reaches.

        A record whose only source is the matter's own files gets no dropzone at all. Rendering one
        that silently swallows the file is worse than not offering it: the person watches their
        document go in, sees nothing attached, and has no way to tell that from a failure.
      -->
      {#if onAttachUpload}
        <Dropzone
          multiple
          disabled={!canEdit}
          label="Upload a file from this computer"
          prompt="Upload…"
          onFiles={(files) => onAttachUpload(files)}
        />
      {/if}

      {#if !canEdit && attachDisabledReason !== undefined}
        <p class="mc-record-attachments-refusal">{attachDisabledReason}</p>
      {:else if !canSearchDocuments && documentSourceDisabledReason !== undefined}
        <p class="mc-record-attachments-refusal">{documentSourceDisabledReason}</p>
      {/if}
    </div>
  {/if}

  {#if errorMessage !== undefined}
    <Alert.Root variant="danger">
      <Alert.Title>The Attachments Could Not Be Loaded</Alert.Title>
      <Alert.Description>
        <span class="mc-record-attachments-error-message">{errorMessage}</span>
        {#if errorIdentifier}
          <span class="mc-record-attachments-error-identifier">Error {errorIdentifier}</span>
        {/if}
      </Alert.Description>
      {#if onRetry}
        <div class="mc-record-attachments-error-actions">
          <Button variant="secondary" size="sm" onclick={onRetry}>Try Again</Button>
        </div>
      {/if}
    </Alert.Root>
  {:else if loading}
    <p class="sr-only">{loadingMessage}</p>
    <div class="mc-record-attachments-list" aria-hidden="true">
      {#each PLACEHOLDER_ROWS as placeholder (placeholder)}
        <div class="mc-record-attachments-item">
          <Skeleton class="mc-record-attachments-placeholder-icon" />
          <div class="mc-record-attachments-item-text">
            <Skeleton class="mc-record-attachments-placeholder-line w-48" />
            <Skeleton class="mc-record-attachments-placeholder-line w-32" />
          </div>
        </div>
      {/each}
    </div>
  {:else if attachments.length === 0}
    <!-- The invitation names only the sources this record actually has, so it never points at a
         control that is not on screen. -->
    <EmptyState title="Nothing Attached Yet">
      {#if onAttachUpload}
        Point this record at a document the matter already holds, or upload one.
      {:else}
        Point this record at a document the matter already holds.
      {/if}
    </EmptyState>
  {:else}
    <ul class="mc-record-attachments-list">
      {#each attachments as attachment (attachment.identifier)}
        <li class="mc-record-attachments-item">
          <FileIcon
            contentType={attachment.contentType}
            fileName={attachment.name}
            class="mc-record-attachments-item-icon"
          />
          <div class="mc-record-attachments-item-text">
            {#if onOpen}
              <button
                type="button"
                class="mc-record-attachments-item-name"
                onclick={() => onOpen?.(attachment)}
              >
                {attachment.name}
              </button>
            {:else}
              <span class="mc-record-attachments-item-name-text">{attachment.name}</span>
            {/if}
            {#if attachment.attachedAt !== undefined || attachment.attachedBy !== undefined}
              <p class="mc-record-attachments-item-meta">
                {#if attachment.attachedAt !== undefined}
                  <time datetime={instantAttribute(attachment.attachedAt)}>
                    {formatInstant(attachment.attachedAt)}
                  </time>
                {/if}
                {#if attachment.attachedAt !== undefined && attachment.attachedBy !== undefined}
                  <span class="mc-record-attachments-item-separator" aria-hidden="true">·</span>
                {/if}
                {#if attachment.attachedBy !== undefined}
                  <!-- Always the person's own name: the shared formatter is what keeps "You" out. -->
                  <span>{personName(attachment.attachedBy)}</span>
                {/if}
              </p>
            {/if}
          </div>
          {#if onDetach}
            <button
              type="button"
              class="mc-record-attachments-detach"
              disabled={!canEdit}
              title={canEdit ? "Detach" : attachDisabledReason}
              aria-label={detachLabel(attachment)}
              onclick={() => (pendingDetach = attachment)}
            >
              <Unlink class="mc-record-attachments-detach-icon" aria-hidden="true" />
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if preview}
    <div class="mc-record-attachments-preview">{@render preview()}</div>
  {/if}

</div>

<!--
  The confirmation. It names what stops and, in the same breath, where the document will still be —
  because the fear this dialog has to answer is that pressing Detach destroys the file.
-->
<ActionDialog
  kind="confirm"
  bind:open={() => pendingDetach !== null, (open) => {
    if (!open) pendingDetach = null;
  }}
  heading="Detach This Document"
  subtitle={{ facts: [pendingDetach?.name ?? "It"] }}
  commitLabel="Detach"
  unsavedChanges={false}
  onCommit={confirmDetach}
>
  {#snippet fields()}
    <!-- The fear this panel has to answer is that Detach destroys the file, so where the document
         will still be is said in the panel's body rather than in the line that names it. -->
    <p>
      It stops being attached to this record. The document itself stays in this matter's files, with
      everything else recorded about it.
    </p>
  {/snippet}
</ActionDialog>
