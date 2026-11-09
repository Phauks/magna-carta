<script lang="ts">
  /*
   * One call or text — recorded, read, and corrected. ONE WINDOW FOR ALL THREE.
   *
   * WHY THERE IS NOT A SECOND ONE (owner ruling, 2026-09-08: "we now have two modals for creating a
   * call which is weird"). There were two. A dialog recorded a call and this window read one, they
   * rendered the same fields through the same component, and they still disagreed about everything
   * around those fields: one had tabs and the other did not, one printed and the other did not, one
   * called its commit Save under a heading and the other under an action bar. Two surfaces for one
   * record is two things for a reader to learn and two places for the next field to be added to only
   * one of. So opening a row and recording a new one are the same window, and the only difference
   * between them is whether it starts with a record in it.
   *
   * WHAT THE TWO STATES ACTUALLY DIFFER IN, and it is a short list. A new record opens straight into
   * the fields, because there is nothing to read yet. It asks WHERE IT BELONGS, because at that
   * moment the anchor is simply one of the things being said — where a record already on the log
   * moves between anchors through its own concurrency-safe acts in the action bar, and offering a
   * field as well would be two ways to do one thing. And it carries the number it is ABOUT to be
   * given rather than the one it has.
   *
   * THE NUMBER IS SHOWN BEFORE THE RECORD EXISTS (owner ruling, 2026-09-08: a call should be
   * identifiable in the log "before it has been created"). Somebody still on the telephone needs
   * something to write on a slip and read back to the caller, and the save is too late for the
   * sentence they are in the middle of. It is a preview and the window says so: nothing is drawn by
   * asking, so a call recorded first takes that number and this one moves on — which is why the
   * subtitle switches to the record's own number the moment there is a record.
   *
   * AN INTAKE STARTS FROM HERE, AND FROM THE FORM AS WELL (owner ruling, 2026-09-08). A call from
   * somebody who wants the firm to act is where an intake starts, and the person taking that call is
   * in this window, not in the matters screen. Starting one from a record being ENTERED records the
   * call first — an intake with no account of the call that caused it is the one thing this window
   * exists to prevent — and then hands the saved record up.
   *
   * CORRECTING THE RECORD AND DECIDING WHERE IT BELONGS ARE DIFFERENT ACTS on a record that already
   * exists. Edit changes what the record SAYS — the number, the direction, the date, the
   * description. Where it belongs is a decision about the firm's work rather than a field of the
   * record, it is what the queue exists to collect, and each of its moves is a concurrency-safe act
   * of its own so that two people filing the same message in the same instant cannot both succeed.
   *
   * SEVERAL CALLS AT ONCE (owner, 2026-11-09: "it can handle multiple numbers coming in at the same
   * time, for example, calls when already in a call"). A record being made is one of a LIST of
   * calls being written down, down the left side of the pane ("calls should be on the leftside, not
   * above it"); Another Call adds one, saving one takes it off the list and leaves the rest, and the
   * window closes only when the last is saved. Starting an intake from one saves that one and leaves
   * the others standing. The right side, while a record is being made, is the Identification panel
   * and the number's own History, both read from the number as soon as it is a whole one.
   *
   * A CARRIER-WRITTEN RECORD IS NOT EDITABLE, and it says so rather than hiding Edit. It is what the
   * network reported; a member changing it would turn an observation into a recollection wearing an
   * observation's badge, which is the one thing the `producer` column exists to prevent.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EventRail from "@magna-carta/design-system/event-rail";
  import type { EventRailEvent } from "@magna-carta/design-system/event-rail";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import { PreviewedNumber } from "@magna-carta/design-system/record-reference";
  import type {
    RecordReference,
    RecordSubject,
  } from "@magna-carta/design-system/record-reference";
  import { formatInstant, personName } from "@magna-carta/design-system/formatters";
  import FilePlus2 from "@lucide/svelte/icons/file-plus-2";
  import Plus from "@lucide/svelte/icons/plus";
  import FolderInput from "@lucide/svelte/icons/folder-input";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { viewerTimeZone } from "$lib/dates";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { readDirectoryEntity } from "$lib/directory/directory-api.ts";
  import { directoryEntityName } from "$lib/directory/entity-presentation.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import CommunicationFields from "./communication-fields.svelte";
  import CommunicationIdentification from "./communication-identification.svelte";
  import CommunicationNumberHistory from "./communication-number-history.svelte";
  import FileToMatterDialog from "./file-to-matter-dialog.svelte";
  import SetAsideDialog from "./set-aside-dialog.svelte";
  import { communicationSheet } from "./communication-print-sheet.ts";
  import {
    anchorText,
    CALL_OUTCOME_LABELS,
    SPAM_KIND_LABELS,
    attachmentNote,
    channelEntry,
    counterpartyNumberText,
    directionEntry,
    dispositionEntry,
    durationText,
    spanText,
  } from "./communication-vocabulary.ts";
  import {
    clearCommunicationDisposition,
    fileCommunicationToMatter,
    logCommunication,
    newWriteKey,
    readCommunication,
    readNextCommunicationNumber,
    unfileCommunicationFromMatter,
    updateCommunication,
    type Communication,
    type IntakeSource,
  } from "./communications-api.ts";
  import {
    draftFromCommunication,
    draftOccurredAt,
    emptyLogDraft,
    activityRequest,
    logDraftReady,
    logDraftRequest,
    logDraftShortfalls,
    updateDraftRequest,
    type LogDraft,
  } from "./log-draft.ts";

  let {
    open = $bindable(false),
    communicationId,
    matters,
    mattersCapped = false,
    matterId = null,
    matterFixed = false,
    matterName = null,
    canWrite = true,
    canReviewQueue = false,
    onChanged,
    onStartIntake,
  }: {
    open?: boolean;
    /**
     * The record being read, or NULL to record a new one.
     *
     * Null is the create state rather than an absence: the window is shown by `open` alone, so a
     * surface opens it with no id when somebody presses New and with an id when they open a row.
     */
    communicationId: string | null;
    /** The anchors a row may be filed onto — caseload, consultations AND intakes. */
    matters: readonly SheetMatter[];
    mattersCapped?: boolean;
    /** The matter a new record is being made on, where the window was opened from inside one. */
    matterId?: string | null;
    /**
     * Whether that matter is settled rather than merely suggested.
     *
     * True inside a matter, where the decision is already made — and there the anchor control is not
     * disabled, it is ABSENT. A disabled control implies a choice is being withheld, and an empty one
     * implies the row is on no matter, which is the opposite of what is true.
     */
    matterFixed?: boolean;
    /** What that settled matter is called, so the line names it rather than printing a handle. */
    matterName?: string | null;
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
    onStartIntake?: (communication: IntakeSource) => void;
  } = $props();

  const now = (): string => new Date().toISOString();

  /** Whether this window is making a record rather than showing one. */
  const creating = $derived(communicationId === null);

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

  /*
   * THE CALLS BEING WRITTEN DOWN, while the window is making records. Each entry holds its own
   * draft; `draft` above is the one on screen, and it IS that entry's draft rather than a copy of
   * it, so typing into the form writes straight into the entry and switching loses nothing.
   */
  interface CallEntry {
    readonly key: string;
    draft: LogDraft;
  }
  let entries = $state<CallEntry[]>([]);
  let activeKey = $state<string | null>(null);
  let entrySequence = 0;

  /** Matters chosen from the Identification panel that the anchor list did not already carry. */
  let filedFromPanel = $state<SheetMatter[]>([]);
  const anchorMatters = $derived.by((): readonly SheetMatter[] => {
    const known = new Set(matters.map((matter) => matter.id));
    return [...matters, ...filedFromPanel.filter((matter) => !known.has(matter.id))];
  });

  function freshDraft(): LogDraft {
    return {
      ...emptyLogDraft(now()),
      matterId,
      anchor: matterId === null ? "undecided" : "matter",
    };
  }

  function showEntry(key: string): void {
    const entry = entries.find((candidate) => candidate.key === key);
    if (entry === undefined) return;
    activeKey = key;
    draft = entry.draft;
    saveFailure = null;
  }

  function addCall(): void {
    entrySequence += 1;
    const key = `call-${entrySequence}`;
    entries.push({ key, draft: freshDraft() });
    showEntry(key);
  }

  /**
   * Take the call on screen off the list, now that it is on the log. The window closes on the
   * last one, because there is nothing left in it to do.
   */
  function retireActiveEntry(): void {
    const remaining = entries.filter((entry) => entry.key !== activeKey);
    entries = remaining;
    const next = remaining.at(0);
    if (next === undefined) {
      activeKey = null;
      open = false;
      return;
    }
    showEntry(next.key);
  }

  /** Whether a draft has anything in it. A blank call has nothing to lose, so leaving never asks. */
  function draftStarted(candidate: LogDraft): boolean {
    return (
      candidate.counterpartyNumber.trim() !== "" ||
      candidate.description.trim() !== "" ||
      candidate.durationText.trim() !== "" ||
      candidate.counterpartyEntityId !== null ||
      candidate.matterId !== null ||
      candidate.disposition !== null ||
      candidate.callerIdName.trim() !== "" ||
      candidate.outcome !== null
    );
  }

  /** How a call reads in the list on the left: who, else the number, else that it is new. */
  function entryTitle(candidate: LogDraft): string {
    if (candidate.counterpartyName !== null) return candidate.counterpartyName;
    const typed = candidate.counterpartyNumber.trim();
    return typed === "" ? "New call" : typed;
  }

  function entryDetail(candidate: LogDraft): string {
    const kind = candidate.kind === "text" ? "Text" : "Call";
    return `${directionEntry(candidate.direction).label} ${kind.toLowerCase()} · not saved`;
  }

  function fileFromPanel(matter: SheetMatter): void {
    if (!matters.some((known) => known.id === matter.id)) {
      filedFromPanel = [...filedFromPanel.filter((known) => known.id !== matter.id), matter];
    }
    draft.matterId = matter.id;
    draft.disposition = null;
    draft.anchor = "matter";
  }

  /**
   * The number a record being entered WOULD draw, or null while nothing has answered.
   *
   * Null rather than a guess: a made-up number on a message slip is worse than none, and the line
   * under the heading simply says the number is drawn when it is saved until this arrives.
   */
  /*
   * The number this record would draw, held by the shared seam rather than by this file.
   * "Communication" rather than the chosen channel for the same reason the heading is: a line that
   * renamed itself under the hand of the person filling it in is a panel arguing with its reader.
   */
  const previewed = new PreviewedNumber("Communication");

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
    if (!open) {
      // A closed window holds no calls: everything in it was either saved or knowingly abandoned.
      untrack(() => {
        entries = [];
        activeKey = null;
        filedFromPanel = [];
      });
      return;
    }
    saveFailure = null;
    anchorProblem = null;
    void firmRoster.load(fetch);
    if (communicationId === null) {
      // A record being made opens in the fields, because there is nothing yet to read.
      record = null;
      readFailure = null;
      editing = true;
      untrack(() => {
        if (entries.length === 0) addCall();
      });
      return;
    }
    editing = false;
    readRecord();
  });

  /*
   * The number a record being entered would draw, kept in step with the DAY it says it happened.
   *
   * Its own effect, and it reads the two date fields rather than the whole draft, so typing a
   * description does not ask the server anything — and so that somebody writing up Tuesday's call on
   * Thursday is shown Tuesday's next number rather than today's. It writes only the previewed number,
   * which nothing here reads back, so it cannot re-enter.
   */
  $effect(() => {
    if (!open || communicationId !== null) {
      previewed.clear();
      return;
    }
    const occurredAt = draftOccurredAt(draft);
    void previewed.read(async () => {
      // The seam takes a number or nothing; the app's outcome model stays in the app. A refused or
      // unreachable read is not an error to raise here — the panel still records the call, and the
      // line already says a number is drawn by the save.
      const outcome = await readNextCommunicationNumber(fetch, occurredAt);
      return outcome.kind === "ok" ? outcome.value.referenceNumber : null;
    });
  });

  /*
   * The line under the heading: this record, by the number somebody quotes.
   *
   * WHILE IT IS BEING ENTERED the number is the one the NEXT record would draw, because the person
   * typing is usually still on the telephone and the save is too late for the sentence they are in
   * the middle of. Nothing is reserved by asking, and the shell says so in the words it says
   * everywhere.
   */
  const subtitle = $derived<RecordSubject>(
    creating
      ? { reference: previewed.reference }
      : record === null
        ? {}
        : {
            reference: {
              kind: channelEntry(record.channel).label,
              number: record.referenceNumber,
            },
            facts: [directionEntry(record.direction).label, formatInstant(record.occurredAt)],
          },
  );

  /*
   * The record as the two queue acts name it. Both panels act on THIS row, so both state its own
   * number rather than describing what filing or setting aside does — the heading already says
   * that, and a handle is not something a reader can check.
   */
  const actingReference = $derived<RecordReference | null>(
    record === null
      ? null
      : { kind: channelEntry(record.channel).label, number: record.referenceNumber },
  );

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

  /*
   * ONE NAME FOR THE PANEL WHILE A RECORD IS BEING MADE, whichever type is being recorded (owner
   * ruling, 2026-09-08): Record Communication. The heading used to change to Record A Text the
   * moment somebody switched the type — a panel renaming itself under the hand of the person filling
   * it in. Once there IS a record, the heading is what the record is.
   */
  const heading = $derived(
    creating ? "Record Communication" : record === null ? "" : channelEntry(record.channel).label,
  );

  const carried = $derived(record === null ? null : attachmentNote(record.channel));
  const length = $derived(record === null ? null : durationText(record.durationSeconds));
  const span = $derived(record === null ? null : spanText(record.occurredAt, record.endedAt));
  const description = $derived(record === null ? "" : (record.body ?? record.summary ?? ""));

  const editRefusal = $derived.by((): string | undefined => {
    if (!canWrite) return "Your account cannot change the firm's call and text log.";
    // A record being made has no read state to fall back to, so the toggle out of the fields is
    // refused rather than offered: the way out of an entry is Save or the abandon beside it.
    if (creating) return "This one has not been recorded yet.";
    if (record === null) return "Reading the record.";
    if (record.producer === "carrier") {
      return "The carrier reported this one. A member's correction would make it read as something it is not.";
    }
    return undefined;
  });

  const saveRefusal = $derived.by((): string | undefined => {
    if (!creating && record === null) return "Reading the record.";
    if (saving) return "Saving.";
    return logDraftReady(draft, now()) ? undefined : logDraftShortfalls(draft, now())[0];
  });

  /** Whether anything has been entered. A blank new record has nothing to lose, so leaving never asks. */
  const started = $derived(entries.some((entry) => draftStarted(entry.draft)));

  /**
   * Record what was entered, and answer with the new row.
   *
   * Every attempt carries its own key, so a retried submit — or a first attempt that died on a
   * dropped connection — cannot put two identical accounts of one phone call on the matter.
   */
  async function writeNewRecord(): Promise<string | null> {
    saving = true;
    saveFailure = null;
    const written = await logCommunication(
      fetch,
      { ...logDraftRequest(draft), ...activityRequest(draft, viewerTimeZone()) },
      newWriteKey(),
    );
    saving = false;
    if (written.kind !== "ok") {
      saveFailure = stated(
        written.failure,
        "The call or text could not be recorded.",
        // Nothing answered is a stronger statement than a refusal, and it is the one a person about
        // to press the button again needs: nothing was written, so pressing again records one row.
        "Nothing answered. Nothing was recorded.",
      );
      return null;
    }
    onChanged();
    return written.value.id;
  }

  async function correct(): Promise<void> {
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

  async function save(): Promise<void> {
    if (!creating) {
      await correct();
      return;
    }
    // The call just made leaves the list, and the window closes only when it was the last: what it
    // would otherwise show is a record the reader is already looking at on the log behind it.
    if ((await writeNewRecord()) !== null) retireActiveEntry();
  }

  /**
   * Record what has been entered, then open an intake for whoever was at the other end.
   *
   * The save comes FIRST and the intake only follows a save that landed. An intake opened from an
   * unrecorded call would leave the receptionist's account of the first contact as the one thing the
   * new matter does not have, which is the whole reason this control is here rather than on the
   * matters screen.
   */
  async function recordThenIntake(): Promise<void> {
    const contact = draft.counterpartyEntityId;
    const id = await writeNewRecord();
    if (id === null) return;
    // Only THIS call leaves. Any other call still being written down stays in the window, which is
    // why the intake is handed up rather than replacing it.
    retireActiveEntry();
    // The two facts an intake needs from the call: which row to file onto the matter it opens, and
    // who to seed as the client. Both are held here rather than read back, so an intake still opens
    // when the log is momentarily unreadable — the call is already recorded either way.
    onStartIntake?.({ id, counterpartyEntityId: contact });
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

  /**
   * Abandon the change — and, on a record being MADE, abandon the record.
   *
   * The shell has already left editing by the time this runs, which is right for a correction and
   * wrong for an entry: there is nothing behind the fields of a new record to fall back to, so the
   * window would sit open showing an empty pane. Cancelling an entry closes it, which is what
   * cancelling an entry means.
   */
  function forgetChanges(): void {
    saveFailure = null;
    anchorProblem = null;
    if (creating) {
      // Abandoning an entry abandons every call listed in it: the close guard has already asked.
      entries = [];
      activeKey = null;
      open = false;
      return;
    }
    if (record !== null) draft = draftFromCommunication(record, counterpartyName);
  }

  /**
   * The record's own history, from what the record holds.
   *
   * NOT AN AUDIT FEED, and the difference is worth stating rather than hiding: the log's audit rows
   * are a compliance record with their own retention and their own readers, and no route serves them
   * to a screen. What this rail carries is what the RECORD itself says about how it came to exist —
   * who wrote it down and when, and whether it has been changed since. That answers the question a
   * reader of a hand-logged call actually brings, which is whether they are reading an observation
   * or somebody's recollection, and how old the recollection is.
   */
  const historyEvents = $derived.by((): readonly EventRailEvent[] => {
    const held = record;
    if (held === null) return [];
    const carrierWritten = held.producer === "carrier";
    const events: EventRailEvent[] = [
      {
        id: `${held.id}:recorded`,
        action: carrierWritten ? "Reported by the carrier" : "Written down by a member",
        at: held.createdAt,
        source: carrierWritten
          ? "The carrier"
          : (nameOf(held.loggedByUserId) ?? "Nobody recorded"),
      },
    ];
    // Only where it has actually moved: a record saved once carries the same instant in both
    // columns, and a "Changed" row on it would say something untrue.
    if (held.updatedAt !== held.createdAt) {
      events.push({
        id: `${held.id}:changed`,
        action: "Changed",
        at: held.updatedAt,
        source: "A member",
      });
    }
    return events;
  });

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


{#snippet fact(label: string, value: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right">{value}</dd>
  </div>
{/snippet}

{#snippet recordPane({ editing: inEdit }: { editing: boolean })}
  {#if creating}
    <div class="flex gap-24">
      <!-- The calls being written down, one per caller, down the left (owner, 2026-11-09). Each is
           a press away, and the one on screen is marked as the current one. -->
      <nav aria-label="Calls being recorded" class="flex w-3xs shrink-0 flex-col gap-4">
        <FieldLabel as="h3">Calls · {entries.length}</FieldLabel>
        {#each entries as entry (entry.key)}
          {@const current = entry.key === activeKey}
          <Button
            variant={current ? "secondary" : "ghost"}
            class="h-auto flex-col items-start gap-0 py-8 text-left"
            aria-current={current ? "true" : undefined}
            disabled={saving}
            onclick={() => showEntry(entry.key)}
          >
            <span class="font-medium">{entryTitle(entry.draft)}</span>
            <span class="text-xs font-normal text-text-muted">{entryDetail(entry.draft)}</span>
          </Button>
        {/each}
        <Button variant="ghost" size="sm" class="self-start" disabled={saving} onclick={addCall}>
          <Plus aria-hidden="true" />
          Another Call
        </Button>
      </nav>
      <div class="min-w-0 flex-1">
        {@render paneBody(inEdit)}
      </div>
    </div>
  {:else}
    {@render paneBody(inEdit)}
  {/if}
{/snippet}

{#snippet paneBody(inEdit: boolean)}
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
        title={creating ? "Nothing Was Recorded" : "Nothing Was Changed"}
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
      <!-- The anchor is a FIELD only while the record is being made. On one already on the log,
           where it belongs is a decision rather than a field, and it is made in the action bar
           below where it is one press from a row somebody just opened. -->
      <CommunicationFields
        bind:draft
        busy={saving}
        matters={creating ? anchorMatters : []}
        {mattersCapped}
        {matterFixed}
        {matterName}
        showAnchor={creating}
        showContact={!creating}
        showActivity={creating}
      />
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
        {#if record.outcome !== null}
          <Badge variant="neutral">
            {record.outcome === "spam" && record.spamKind !== null
              ? `Spam · ${SPAM_KIND_LABELS[record.spamKind]}`
              : CALL_OUTCOME_LABELS[record.outcome]}
          </Badge>
        {/if}
        {#if carried !== null}
          <Badge variant="neutral">{carried}</Badge>
        {/if}
      </div>

      <dl class="flex flex-col gap-4 text-sm">
        {@render fact("When", formatInstant(record.occurredAt))}
        {@render fact("Number", counterpartyNumberText(record.counterpartyNumber))}
        {#if record.callerIdName !== null}
          {@render fact("Caller ID", record.callerIdName)}
        {/if}
        {#if record.outcome === "transferred"}
          {@render fact("Transferred to", nameOf(record.memberUserId) ?? "A colleague")}
        {/if}
        {#if span !== null && span !== length}
          <!-- Only where it DIFFERS from the length. A call whose span and length agree has one
               fact, said once; a call put on hold has two, and both of them are true. -->
          {@render fact("On the line", span)}
        {/if}
        {#if length !== null}
          {@render fact("Duration", length)}
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

<!-- The history is the rail and nothing beside it. Where data will arrive, the structure that will
     hold it renders first, and the words that explain the emptiness live inside its own empty
     state, short (owner ruling, 2026-09-14). The rail renders its empty line rather than an empty
     frame today; the frame is a design-system change. -->
<!-- The number the call on screen will draw, and nothing else, in italics because it is a preview
     rather than the record's own (owner, 2026-11-09: change the sentence "to the number but
     italicized"). Nothing is reserved by showing it; the save draws the record's own. -->
{#snippet previewSubtitle()}
  {#if previewed.reference.number === null}
    <span>The number is drawn when it is saved</span>
  {:else}
    <em class="tabular-nums" title="The number this call will get when it is saved, if nothing else is saved first">
      {previewed.reference.number}
    </em>
  {/if}
{/snippet}

<!-- While a record is being made the right side works from the NUMBER: who it belongs to and their
     open matters, then every earlier call and text with it. -->
{#snippet identificationTab()}
  <CommunicationIdentification bind:draft busy={saving} onFile={fileFromPanel} />
{/snippet}

{#snippet numberHistoryTab()}
  <CommunicationNumberHistory {draft} />
{/snippet}

{#snippet historyTab()}
  <EventRail
    events={historyEvents}
    label="This call or text's history"
    emptyMessage="Nothing has been recorded about this record yet."
  />
{/snippet}

{#snippet actions({ editing: inEdit }: { editing: boolean })}
  <!-- A record being ENTERED offers only its Save here; starting an intake from it lives in the
       header's menu (owner, 2026-11-09: "move start an intake somewhere else on the page, maybe top
       right area"), where it cannot be pressed in place of Save. -->
  {#if !creating && !inEdit && record !== null}
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
        <Button
          variant="secondary"
          onclick={() => {
            open = false;
            onStartIntake(held);
          }}
        >
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
  {#if creating && onStartIntake !== undefined}
    <!-- It saves first: an intake with no account of the call that started it is exactly what this
         control exists to prevent. Only this call is saved and handed up; any other call being
         written down stays in the window. -->
    <DropdownMenu.Item disabled={saveRefusal !== undefined} onSelect={() => void recordThenIntake()}>
      <FilePlus2 aria-hidden="true" />
      Start An Intake
    </DropdownMenu.Item>
  {/if}
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
  subtitle={creating ? previewSubtitle : subtitle}
  record={recordPane}
  {actions}
  menu={creating && onStartIntake === undefined ? undefined : menu}
  tabs={creating
    ? ([
        { key: "identification", label: "Identification", content: identificationTab },
        { key: "number-history", label: "History", content: numberHistoryTab },
      ] satisfies RecordWindowTab[])
    : ([{ key: "history", label: "History", content: historyTab }] satisfies RecordWindowTab[])}
  editDisabledReason={editRefusal}
  saveDisabledReason={saveRefusal}
  unsavedChanges={creating ? started : editing}
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
  reference={actingReference}
  {matters}
  {mattersCapped}
  onFiled={anchorMoved}
/>

<SetAsideDialog
  bind:open={setAsideOpen}
  communicationId={record?.id ?? null}
  reference={actingReference}
  onSetAside={anchorMoved}
/>
