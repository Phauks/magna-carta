<script lang="ts">
  /*
   * Inserting the pages of another PDF into the one on the Pages tab: which file, and where its
   * pages go. The file is one of the matter's own or one from the reader's computer, and the two
   * sources share one slot, so choosing between them never moves the fields below. A document on
   * the File Workbench has no matter, so there the computer is the only source and no choice is shown.
   *
   * Nothing is saved here. Insert reads the file, checks it opens, and hands its pages to the tab's
   * arrangement, where they can be moved, turned or deleted like any other page before Save.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import FileInput from "@magna-carta/design-system/file-input";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import MatterDocumentPicker from "$lib/documents/matter-document-picker.svelte";
  import {
    insertableDocument,
    openInsertedFile,
    type InsertedFileChoice,
    type OpenedInsertion,
  } from "./inserted-file.ts";
  import type { InsertPlace } from "./page-arrangement.ts";

  let {
    open = $bindable(false),
    name,
    matterId,
    pageCount,
    suggestedPosition,
    onInsert,
  }: {
    open?: boolean;
    /** The name of the document being edited. */
    name: string;
    /** The matter the other file can be chosen from, or null for a document on no matter. */
    matterId: string | null;
    /** How many pages the arrangement holds now, so a position can be checked. */
    pageCount: number;
    /** The page the inserted pages go after when the dialog opens: the last chosen page, if any. */
    suggestedPosition: number | null;
    onInsert: (opened: Extract<OpenedInsertion, { kind: "ready" }>, place: InsertPlace) => void;
  } = $props();

  type From = "matter" | "computer";
  type Where = "before" | "after" | "end";

  const startFrom = (): From => (matterId === null ? "computer" : "matter");
  let from = $state<From>(startFrom());
  let matterFileId = $state<string | null>(null);
  let computerFile = $state<File | null>(null);
  let where = $state<Where>("end");
  let positionText = $state("");
  let refusal = $state<string | null>(null);

  const position = $derived(Number.parseInt(positionText, 10));
  const positionProblem = $derived(
    where === "end"
      ? undefined
      : Number.isInteger(position) && position >= 1 && position <= pageCount
        ? undefined
        : pageCount === 1
          ? "Enter page 1."
          : `Enter a page from 1 to ${pageCount}.`,
  );
  const choice = $derived<InsertedFileChoice | null>(
    from === "matter"
      ? matterFileId === null
        ? null
        : { kind: "matter", fileId: matterFileId }
      : computerFile === null
        ? null
        : { kind: "computer", file: computerFile },
  );
  const commitRefusal = $derived(
    choice === null ? "Choose a file." : positionProblem === undefined ? undefined : positionProblem,
  );

  function reset(): void {
    from = startFrom();
    matterFileId = null;
    computerFile = null;
    refusal = null;
    where = suggestedPosition === null ? "end" : "after";
    positionText = String(suggestedPosition ?? pageCount);
  }

  function chooseFromComputer(event: Event & { currentTarget: HTMLInputElement }): void {
    computerFile = event.currentTarget.files?.[0] ?? null;
    refusal = null;
  }

  async function insert(): Promise<ActionOutcome> {
    refusal = null;
    if (choice === null || positionProblem !== undefined) return "refused";
    const opened = await openInsertedFile(choice);
    if (opened.kind === "refused") {
      refusal = opened.message;
      return "refused";
    }
    onInsert(opened, where === "end" ? { kind: "end" } : { kind: where, position });
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  heading="Insert Pages"
  subtitle={{ facts: [name] }}
  commitLabel="Insert"
  commitBusyLabel="Inserting"
  {commitRefusal}
  unsavedChanges={choice !== null}
  onOpen={reset}
  onCommit={insert}
>
  {#snippet notice()}
    {#if refusal !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Pages Not Inserted</Alert.Title>
        <Alert.Description>{refusal}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      {#if matterId !== null}
      <div class="flex flex-col gap-8">
        <span class="mc-label" id="insert-pages-from">From</span>
        <SegmentedControl.Root
          aria-labelledby="insert-pages-from"
          value={from}
          disabled={busy}
          onValueChange={(next) => {
            from = next === "computer" ? "computer" : "matter";
            refusal = null;
          }}
        >
          <SegmentedControl.Item value="matter">This Matter</SegmentedControl.Item>
          <SegmentedControl.Item value="computer">Your Computer</SegmentedControl.Item>
        </SegmentedControl.Root>
      </div>
      {/if}

      <div class="flex flex-col gap-8">
        {#if from === "matter" && matterId !== null}
          <Label necessity="required" for="insert-pages-matter-file">File</Label>
          <MatterDocumentPicker
            bind:value={matterFileId}
            {matterId}
            inputId="insert-pages-matter-file"
            fieldName="File"
            disabled={busy}
            accepts={insertableDocument}
            noMatterNote="This document isn't on a matter."
            noFilesNote="This matter has no other PDFs yet."
          />
        {:else}
          <Label necessity="required" for="insert-pages-computer-file">File</Label>
          <FileInput
            id="insert-pages-computer-file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onchange={chooseFromComputer}
          />
        {/if}
      </div>

      <div class="flex flex-col gap-8">
        <span class="mc-label" id="insert-pages-where">Where</span>
        <SegmentedControl.Root
          aria-labelledby="insert-pages-where"
          value={where}
          disabled={busy}
          onValueChange={(next) => (where = next === "before" || next === "after" ? next : "end")}
        >
          <SegmentedControl.Item value="before">Before Page</SegmentedControl.Item>
          <SegmentedControl.Item value="after">After Page</SegmentedControl.Item>
          <SegmentedControl.Item value="end">At the End</SegmentedControl.Item>
        </SegmentedControl.Root>
      </div>

      <LabelledField
        label="Page"
        necessity={where === "end" ? "optional" : "required"}
        error={positionText === "" ? undefined : positionProblem}
      >
        {#snippet children({ props })}
          <Input
            {...props}
            type="number"
            min="1"
            max={String(pageCount)}
            class="tabular-nums"
            disabled={busy || where === "end"}
            title={where === "end" ? "The pages go after the last page." : undefined}
            value={positionText}
            oninput={(event) => (positionText = event.currentTarget.value)}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}
</ActionDialog>
