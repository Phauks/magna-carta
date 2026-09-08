<script lang="ts">
  /*
   * One call or text, opened.
   *
   * WHY THE ROW OPENS AT ALL. The first cut of this screen deliberately had no record window: every
   * field was on the row, so a window would have been a second way to read what was already on
   * screen, and a row's activation did the thing a reader was actually reaching for — it went to the
   * matter. That reasoning did not survive contact with the screen (owner, 2026-09-08). A record you
   * cannot open is a record you cannot CORRECT, and a hand-logged call is somebody's recollection
   * typed at speed, so it is wrong sometimes — a digit in the number, the wrong direction, a length
   * in the wrong units. A log nobody can correct is a log people stop trusting, which is worse than
   * one that is occasionally re-opened to read what was already visible.
   *
   * THE FIELDS ARE THE ENTRY FORM'S, LITERALLY. communication-fields.svelte renders both, so
   * correcting a record asks exactly the questions recording one asked, in the same places. Two
   * layouts would disagree within a week about where the number sits.
   *
   * CORRECTING THE RECORD AND DECIDING WHERE IT BELONGS ARE DIFFERENT ACTS, and they are in
   * different places. Edit changes what the record SAYS — the number, the direction, the date, the
   * description. Where it belongs is a decision about the firm's work rather than a field of the
   * record, it is what the queue exists to collect, and each of its moves is a concurrency-safe act
   * of its own so that two people filing the same message in the same instant cannot both succeed.
   * So those live in the action bar, one press from an opened row, and the entry form's own
   * "Belongs to" control is absent here rather than offering a second way to do the same thing.
   *
   * A CARRIER-WRITTEN RECORD IS NOT EDITABLE, and it says so rather than hiding Edit. It is what the
   * network reported; a member changing it would turn an observation into a recollection wearing an
   * observation's badge, which is the one thing the `producer` column exists to prevent.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import { formatInstant, personName } from "@magna-carta/design-system/formatters";
  import FilePlus2 from "@lucide/svelte/icons/file-plus-2";
  import FolderInput from "@lucide/svelte/icons/folder-input";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import { goto } from "$app/navigation";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { readDirectoryEntity } from "$lib/directory/directory-api.ts";
  import { directoryEntityName } from "$lib/directory/entity-presentation.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import CommunicationFields from "./communication-fields.svelte";
  import FileToMatterDialog from "./file-to-matter-dialog.svelte";
  import SetAsideDialog from "./set-aside-dialog.svelte";
  import { communicationSheet } from "./communication-print-sheet.ts";
  import {
    anchorText,
    attachmentNote,
    channelEntry,
    counterpartyNumberText,
    directionEntry,
    dispositionEntry,
    durationText,
  } from "./communication-vocabulary.ts";
  import {
    clearCommunicationDisposition,
    fileCommunicationToMatter,
    newWriteKey,
    readCommunication,
    setCommunicationDisposition,
    unfileCommunicationFromMatter,
    updateCommunication,
    type Communication,
  } from "./communications-api.ts";
  import {
    draftFromCommunication,
    emptyLogDraft,
    logDraftReady,
    logDraftShortfalls,
    updateDraftRequest,
    type LogDraft,
  } from "./log-draft.ts";

  let {
    open = $bindable(false),
    communicationId,
    matters,
    mattersCapped = false,
    canWrite = true,
    canReviewQueue = false,
    onChanged,
    onStartIntake,
  }: {
    open?: boolean;
    /** The record being read. Null while nothing is chosen, which keeps the window closed. */
    communicationId: string | null;
    /** The anchors a row may be filed onto — caseload, consultations AND intakes. */
    matters: readonly SheetMatter[];
    mattersCapped?: boolean;
    /** Whether this account may change the log at all. */
    canWrite?: boolean;
    /** Whether it may work the queue, which is what moving a row between anchors reads on its way. */
    canReviewQueue?: boolean;
    /** The log changed under this window; the surface that opened it re-reads. */
    onChanged: () => void;
    /**
     * Open an intake for whoever is at the other end of this call.
     *
     * Handed up rather than done here: an intake is a matter being opened, which is the matters
     * subsystem's own window, and a call log that learned how to create matters would be the second
     * place in the product that knows what opening one requires.
     */
    onStartIntake?: (communication: Communication) => void;
  } = $props();

  const now = (): string => new Date().toISOString();

  let record = $state<Communication | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let editing = $state(false);
  let saving = $state(false);
  let saveFailure = $state<StatedFailure | null>(null);
  /**
   * What went wrong with an act that moves the row, said as a sentence.
   *
   * A sentence rather than a failure record, because the two acts here — taking a row off a matter,
   * and putting a set-aside one back in the queue — differ in what they failed to do rather than in
   * how they failed, and that is the fact a reader needs. The dialogs that file a row and set one
   * aside carry their own failure bands.
   */
  let anchorProblem = $state<string | null>(null);
  let draft = $state<LogDraft>(emptyLogDraft(new Date().toISOString()));
  let printOpen = $state(false);

  const nameOf = $derived((userId: string | null): string | null => {
    if (userId === null) return null;
    const member = (firmRoster.members ?? []).find((candidate) => candidate.userId === userId);
    return member === undefined ? userId : personName(member.displayName);
  });

  /** Read the record the window was opened on. A new id is a different record and a fresh read. */
  function readRecord(): void {
    const wanted = communicationId;
    if (wanted === null) return;
    record = null;
    readFailure = null;
    void (async () => {
      const outcome = await readCommunication(fetch, wanted);
      // A window the reader has already moved past says nothing about this answer.
      if (communicationId !== wanted) return;
      if (outcome.kind === "ok") {
        record = outcome.value;
        return;
      }
      readFailure = stated(outcome.failure, "That call or text could not be read.");
    })();
  }

  $effect(() => {
    if (!open || communicationId === null) return;
    editing = false;
    saveFailure = null;
    anchorProblem = null;
    readRecord();
    void firmRoster.load(fetch);
  });

  /**
   * The Directory record at the other end, by name.
   *
   * READ FOR THIS RECORD ALONE. No list read names the entity behind a number — the log answers
   * handles and nothing about them, on the custody register's line — so the table shows the number
   * and this window spends one request on the record somebody actually opened. Null until it lands,
   * and null forever where the read fails, in which case the number stands on its own, which is a
   * real answer a person can use where a handle is not.
   */
  let counterpartyName = $state<string | null>(null);

  $effect(() => {
    const entityId = record?.counterpartyEntityId ?? null;
    counterpartyName = null;
    if (entityId === null) return;
    void (async () => {
      const outcome = await readDirectoryEntity(fetch, entityId);
      if ((record?.counterpartyEntityId ?? null) !== entityId) return;
      if (outcome.kind === "ok") counterpartyName = directoryEntityName(outcome.value);
    })();
  });

  // The draft follows the record: entering editing starts from what the record holds, and a record
  // re-read after a save replaces it, so the fields never show a value the server has moved past.
  // It depends on the RECORD alone — a name arriving later patches the draft below rather than
  // rebuilding it, because a rebuild would throw away whatever somebody was in the middle of typing.
  $effect(() => {
    const held = record;
    if (held !== null) draft = draftFromCommunication(held, null);
  });

  $effect(() => {
    const name = counterpartyName;
    if (name !== null && draft.counterpartyEntityId === record?.counterpartyEntityId) {
      draft.counterpartyName = name;
    }
  });

  const heading = $derived(record === null ? "" : channelEntry(record.channel).label);

  const carried = $derived(record === null ? null : attachmentNote(record.channel));
  const length = $derived(record === null ? null : durationText(record.durationSeconds));
  const description = $derived(
    record === null ? "" : (record.body ?? record.summary ?? ""),
  );

  const editRefusal = $derived.by((): string | undefined => {
    if (!canWrite) return "Your account cannot change the firm's call and text log.";
    if (record === null) return "Reading the record.";
    if (record.producer === "carrier") {
      return "The carrier reported this one. A member's correction would make it read as something it is not.";
    }
    return undefined;
  });

  const saveRefusal = $derived.by((): string | undefined => {
    if (record === null) return "Reading the record.";
    if (saving) return "Saving.";
    return logDraftReady(draft, now()) ? undefined : logDraftShortfalls(draft, now())[0];
  });

  async function save(): Promise<void> {
    const held = record;
    if (held === null) return;
    saving = true;
    saveFailure = null;
    const corrected = await updateCommunication(
      fetch,
      held.id,
      updateDraftRequest(draft),
      newWriteKey(),
    );
    saving = false;
    if (corrected.kind !== "ok") {
      saveFailure = stated(
        corrected.failure,
        "The correction was not recorded.",
        "Nothing answered. Nothing was changed.",
      );
      return;
    }
    editing = false;
    readRecord();
    onChanged();
  }

  // ---- where it belongs, as acts rather than as fields -----------------------------------------

  let filingOpen = $state(false);
  let setAsideOpen = $state(false);
  let moving = $state(false);

  /** Why an act that moves the row is unavailable, or undefined when it is available. */
  const moveRefusal = $derived.by((): string | undefined => {
    if (!canWrite) return "Your account cannot change the firm's call and text log.";
    if (!canReviewQueue) return "Your account cannot decide where a call belongs.";
    if (moving) return "Working.";
    return undefined;
  });

  /**
   * Take the row off whatever it is on.
   *
   * Nothing is destroyed either way: a row taken off a matter goes back to the queue with its
   * words, its number and its instant intact, and so does one whose set-aside reason is cleared.
   * That is why neither asks first — an act that loses nothing does not need a question in front of
   * it, and the record it came off is on the log.
   */
  async function returnToQueue(): Promise<void> {
    const held = record;
    if (held === null) return;
    moving = true;
    anchorProblem = null;
    const outcome =
      held.matterId !== null
        ? await unfileCommunicationFromMatter(fetch, held.id, newWriteKey())
        : await clearCommunicationDisposition(fetch, held.id, newWriteKey());
    moving = false;
    if (outcome.kind !== "ok") {
      anchorProblem =
        held.matterId !== null
          ? "It could not be taken off its matter."
          : "It could not be put back in the queue.";
      return;
    }
    readRecord();
    onChanged();
  }

  function anchorMoved(): void {
    anchorProblem = null;
    readRecord();
    onChanged();
  }

  function forgetChanges(): void {
    if (record !== null) draft = draftFromCommunication(record, counterpartyName);
    saveFailure = null;
    anchorProblem = null;
  }

  const sheet = $derived(
    record === null
      ? null
      : communicationSheet(record, {
          counterpartyName,
          memberName: nameOf(record.memberUserId),
          loggedByName: nameOf(record.loggedByUserId),
          instant: (at) => formatInstant(at),
          printedAt: formatInstant(new Date()),
        }),
  );
</script>

{#snippet subtitle()}
  {#if record !== null}
    {directionEntry(record.direction).label} &middot; {formatInstant(record.occurredAt)}
  {/if}
{/snippet}

{#snippet fact(label: string, value: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right">{value}</dd>
  </div>
{/snippet}

{#snippet recordPane({ editing: inEdit }: { editing: boolean })}
  <div class="flex flex-col gap-16">
    {#if readFailure !== null}
      <FailureNotice
        failure={readFailure.failure}
        title="It Could Not Be Read"
        fallback={readFailure.fallback}
        onRetry={readRecord}
      />
    {:else if saveFailure !== null}
      <FailureNotice
        failure={saveFailure.failure}
        title="Nothing Was Changed"
        fallback={saveFailure.fallback}
        whenSilent={saveFailure.whenSilent}
      />
    {/if}

    {#if anchorProblem !== null}
      <Alert.Root variant="warning">
        <Alert.Title>It Was Not Moved</Alert.Title>
        <Alert.Description>{anchorProblem} Where it belongs is unchanged.</Alert.Description>
      </Alert.Root>
    {/if}

    {#if inEdit}
      <!-- No "Belongs to" here: where a record belongs is a decision, not a field, and it is made
           in the action bar below where it is one press from a row somebody just opened. -->
      <CommunicationFields bind:draft busy={saving} matters={[]} showAnchor={false} />
    {:else if record !== null}
      <div class="flex flex-wrap items-center gap-8">
        <Badge variant="neutral" title={channelEntry(record.channel).meaning}>
          {channelEntry(record.channel).label}
        </Badge>
        <Badge variant="neutral" title={directionEntry(record.direction).meaning}>
          {directionEntry(record.direction).label}
        </Badge>
        {#if record.disposition !== null}
          <Badge variant="neutral" title={dispositionEntry(record.disposition).meaning}>
            {dispositionEntry(record.disposition).label}
          </Badge>
        {/if}
        {#if carried !== null}
          <Badge variant="neutral">{carried}</Badge>
        {/if}
      </div>

      <dl class="flex flex-col gap-4 text-sm">
        {@render fact("When", formatInstant(record.occurredAt))}
        {@render fact("Number", counterpartyNumberText(record.counterpartyNumber))}
        {#if length !== null}
          {@render fact("Length", length)}
        {/if}
        {@render fact("Belongs to", anchorText(record))}
      </dl>

      <div class="flex flex-col gap-8">
        <FieldLabel as="h3">Description</FieldLabel>
        <!-- Never clipped: what a member wrote down about a call is the whole value of the record,
             and a description that has to be scrolled away is one nobody reads. -->
        <p class="whitespace-pre-wrap text-sm">
          {description === "" ? "Nothing was written down." : description}
        </p>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet provenanceTab()}
  {#if record !== null}
    <dl class="flex flex-col gap-4 text-sm">
      {@render fact(
        "Source",
        record.producer === "carrier" ? "Reported by the carrier" : "Written down by a member",
      )}
      {@render fact("Firm's side", nameOf(record.memberUserId) ?? "Nobody recorded")}
      {@render fact("Recorded by", nameOf(record.loggedByUserId) ?? "Nobody recorded")}
      {@render fact("Recorded", formatInstant(record.createdAt))}
      {@render fact("Last changed", formatInstant(record.updatedAt))}
    </dl>
    <p class="mt-16 text-xs text-text-muted">
      A member's account of a call and a carrier's report of the same call carry different weight.
      Nothing is sent or received from the platform yet, so every record here was written down by
      whoever made or took the call.
    </p>
  {/if}
{/snippet}

{#snippet actions({ editing: inEdit }: { editing: boolean })}
  {#if !inEdit && record !== null}
    {@const held = record}
    {#if held.matterId !== null}
      <!-- The rest of this case's conversation, which is where a reader who opened a filed row from
           the firm-wide screen was usually heading. -->
      <Button variant="secondary" onclick={() => void goto(`/matters/${held.matterId}/messaging`)}>
        Open The Matter
      </Button>
    {:else if held.disposition !== null}
      <Button
        variant="secondary"
        disabled={moveRefusal !== undefined}
        title={moveRefusal}
        onclick={() => void returnToQueue()}
      >
        <Undo2 aria-hidden="true" />
        Put It Back In The Queue
      </Button>
    {:else}
      <!-- A call from somebody who wants the firm to act is where an intake starts, and making a
           receptionist leave the record, find the intake desk and retype the caller is how a first
           contact stops being recorded at all. -->
      {#if onStartIntake !== undefined}
        <Button variant="secondary" onclick={() => onStartIntake(held)}>
          <FilePlus2 aria-hidden="true" />
          Start An Intake
        </Button>
      {/if}
      <Button
        disabled={moveRefusal !== undefined}
        title={moveRefusal}
        onclick={() => (filingOpen = true)}
      >
        <FolderInput aria-hidden="true" />
        File It Onto A Matter
      </Button>
    {/if}
  {/if}
{/snippet}

{#snippet menu()}
  {#if record !== null}
    {@const held = record}
    {#if held.matterId !== null}
      <DropdownMenu.Item disabled={moveRefusal !== undefined} onSelect={() => void returnToQueue()}>
        Take it off the matter
      </DropdownMenu.Item>
    {:else if held.disposition === null}
      <DropdownMenu.Item
        disabled={moveRefusal !== undefined}
        onSelect={() => (setAsideOpen = true)}
      >
        Set it aside &mdash; not a matter
      </DropdownMenu.Item>
    {/if}
  {/if}
{/snippet}

<RecordWindow
  bind:open
  bind:editing
  {heading}
  {subtitle}
  record={recordPane}
  {actions}
  {menu}
  tabs={[{ key: "provenance", label: "How this was recorded", content: provenanceTab }] satisfies RecordWindowTab[]}
  editDisabledReason={editRefusal}
  saveDisabledReason={saveRefusal}
  unsavedChanges={editing}
  onSave={() => void save()}
  onCancel={forgetChanges}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}

<!-- The two doors out of the queue, each its own act with its own concurrency-safe write. Filing is
     the one that exists only where a matter has to be CHOSEN; setting aside is the one that says
     there is no matter to choose. -->
<FileToMatterDialog
  bind:open={filingOpen}
  communicationId={record?.id ?? null}
  {matters}
  {mattersCapped}
  onFiled={anchorMoved}
/>

<SetAsideDialog
  bind:open={setAsideOpen}
  communicationId={record?.id ?? null}
  onSetAside={anchorMoved}
/>
