<script lang="ts">
  /*
   * A time entry, opened.
   *
   * The window is the product's one record window: the left pane is the record — dense, top-aligned,
   * the changeable facts — and the right pane is the context somebody goes looking for beside it.
   * Nothing about that shape is decided here; this file contributes the field list, the tab set and
   * the action bar, which is the whole of what a record type is allowed to contribute.
   *
   * CHANGING AN ENTRY HAPPENS IN THAT SAME WINDOW. There is no second dialog and no separate route:
   * the window raises its own editing mode, hands this file the mode, and the ONE pane below renders
   * either the values or the fields. The abandon and the commit are the window's own, so "Save" here
   * means what it means on every other kind of record; what this file supplies is the handlers, the
   * one extra verb a new entry wants (Save & New), and the honest answer to whether anything would
   * be lost by walking away.
   *
   * THE ARITHMETIC IS ONE SENTENCE. Worked, rounded to billed, times rate, equals amount, set on one
   * line with the operators between the parts and no box around them. The relationship is the point,
   * and a border around three fields was hiding it rather than showing it.
   *
   * THE DESCRIPTION WRAPS AND GROWS. It is the line the client reads on the bill, so the one window
   * whose job is to show the record whole never clips it, never scrolls it sideways, and never hides
   * it behind an ellipsis.
   *
   * WHAT IS DESIGNED AND NOT YET SERVED STAYS ON SCREEN. The matter picker, the category, the
   * activity code, the rate resolution and its override, the two held billing dispositions and the
   * internal memo are all part of this record; the listing and the write routes carry none of them.
   * Each is therefore rendered where it belongs, refused, saying what it waits on — so a reader can
   * see the record's real shape and can never mistake an unserved field for an empty one.
   */
  import { parseDate } from "@internationalized/date";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import RecordChain from "@magna-carta/design-system/record-chain";
  import EventRail from "@magna-carta/design-system/event-rail";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import * as Combobox from "@magna-carta/design-system/combobox";
  import * as Alert from "@magna-carta/design-system/alert";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatDuration, formatInstant, formatInstantDate } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Info from "@lucide/svelte/icons/info";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import X from "@lucide/svelte/icons/x";
  import Lock from "@lucide/svelte/icons/lock";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
  import MatterPicker from "./matter-picker.svelte";
  import { rateAmount, timekeeperOf } from "./time-columns.ts";
  import { gapReason, TIME_LEDGER_GAPS } from "./time-gaps.ts";
  import { historyEvents } from "./time-entry-history.ts";
  import type { UtbmsCode } from "./time-operations.ts";
  import { UtbmsCatalogue } from "./time-utbms-codes.svelte.ts";
  import {
    timePreferences,
    TIME_ENTRY_MODES,
    TIME_ENTRY_MODE_LABELS,
  } from "./time-preferences.svelte.ts";
  import { matterDisplay, provisionalTimeCode, type SheetMatter } from "./time-sheet-model.ts";
  import {
    attachTimeEntryFile,
    createTimeEntry,
    detachTimeEntryFile,
    draftRefusal,
    listTimeEntryAttachments,
    listTimeEntryEvents,
    parseDurationText,
    parseTimeSpan,
    patchTimeEntry,
    readRoundingPolicy,
    refileTimeEntry,
    roundToIncrement,
    unvoidTimeEntry,
    writeKey,
    type RoundingPolicy,
    type TimeEntryAttachment,
    type TimeEntryDraftFields,
    type TimeEntryEvent,
  } from "./time-operations.ts";
  import { listMatterFiles, type MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { timeEntrySheet } from "./time-print-sheet.ts";
  import { OPEN_RUNGS, listMatterTasks, type MatterTask } from "$lib/matters/tasks-api.ts";
  import { civilDateOf } from "@magna-carta/civil-time/civil-date";
  import { printSheetDates } from "$lib/print-sheet";

  let {
    open = $bindable(false),
    entry = null,
    prefill = null,
    editing = $bindable(false),
    matterId,
    matterTitle,
    matters = [],
    mattersCapped = false,
    members,
    sessionUserId,
    canWorkDraft,
    onSaved,
    onContinueNew,
  }: {
    open?: boolean;
    /** The entry being read, or null while a new one is being written. */
    entry?: TimeEntrySummary | null;
    /**
     * What a NEW entry's fields start holding. Duplicating an entry is what sets it; every other
     * way of starting one leaves it null and the fields open empty. Read only while `entry` is null
     * — an entry that exists is always seeded from itself.
     */
    prefill?: TimeEntryDraftFields | null;
    /**
     * Whether the record's fields are open for change. The window owns this — its Edit control
     * raises it and its abandon lowers it — and it is bound here so a listing can open an entry
     * straight into its fields, and so this file can lower it when a save has actually landed.
     */
    editing?: boolean;
    /**
     * The matter a NEW entry starts on, or null where nothing has decided one.
     *
     * The Time Sheet is firm-wide, so a person can open the full record from a sheet that is on no
     * matter at all. The window then asks for one, because capture takes a matter; opened from a
     * matter it starts there and can still be pointed elsewhere before it is saved.
     */
    matterId: string | null;
    /** That matter's name, where there is one. */
    matterTitle: string | null;
    /** The firm's matters, for the new-entry picker. A caller that always has one passes none. */
    matters?: readonly SheetMatter[];
    /** Whether that list is a page of the record rather than all of it, so the picker says so. */
    mattersCapped?: boolean;
    /** Whose work an entry may be recorded as. A departed colleague is not offered new work. */
    members: readonly FirmMemberSummary[];
    sessionUserId: string | null;
    /** Whether this account may work this draft, and why not when it may not. */
    canWorkDraft: (entry: TimeEntrySummary) => { allowed: boolean; reason: string };
    onSaved: () => void;
    /**
     * Save & New pressed on an entry the firm already holds: the change is saved, and the caller
     * swaps this window onto a fresh entry seeded from these fields. Withheld, Save & New is
     * offered only while creating, where the window can start the next one itself.
     */
    onContinueNew?: (prefill: TimeEntryDraftFields) => void;
  } = $props();

  const creating = $derived(entry === null);

  /*
   * THE FIRM'S ROUNDING POLICY, READ WHEN THE WINDOW OPENS.
   *
   * It decides two things this window has to be able to say: what the entry will actually be
   * BILLED at once the worked time is rounded, and what one billing UNIT is worth. Both were
   * previously registered as gaps and answered with an apology, because the increment was resolved
   * on the server at capture and never served back — so the window showed the worked time as the
   * billed time, which is right for a firm on one-minute increments and wrong for everybody else.
   *
   * It is scoped, because the setting is: a matter can carry its own increment, and so can a
   * member. Until the read lands the window falls back to the platform's own default rather than
   * to nothing, so the fields work from the first frame; the answer replaces it in place.
   */
  const DEFAULT_ROUNDING: RoundingPolicy = { incrementMinutes: 6, roundingDirection: "nearest" };
  let rounding = $state<RoundingPolicy>(DEFAULT_ROUNDING);
  /** Which scope the policy in hand was read for, so a change of matter or staff re-reads it. */
  let roundingReadFor = $state<string | null>(null);
  $effect(() => {
    if (!open) return;
    const scope = `${chosenMatterId ?? ""}:${timekeeperUserId}`;
    if (roundingReadFor === scope) return;
    roundingReadFor = scope;
    void (async () => {
      const outcome = await readRoundingPolicy(fetch, {
        matterId: chosenMatterId,
        timekeeperUserId,
      });
      if (roundingReadFor !== scope) return;
      // A failed read leaves the platform default standing: the field must keep working, and the
      // default is the prevailing one rather than a guess.
      if (outcome.kind === "ok") rounding = outcome.value;
    })();
  });

  /** How the rounding reads, for the hover on the billed figure and the line under the row. */
  const roundingLine = $derived(
    `Billed time is the time worked rounded ${rounding.roundingDirection === "nearest" ? "to the nearest" : rounding.roundingDirection === "up" ? "up to the next" : "down to the last"} ${formatDuration(rounding.incrementMinutes).text}. One unit is ${formatDuration(rounding.incrementMinutes).text}.`,
  );

  let descriptionText = $state("");
  let memoText = $state("");
  /*
   * THE RATE IS NOW A FIELD, AND THE SNAPSHOT RULE IS UNTOUCHED.
   *
   * It used to be read-only here, on the reasoning that an entry keeps the rate in force on its
   * work date for ever. That reasoning is still right and still enforced — a rate card edited later
   * never re-rates a standing entry — but it was answering a different question from the one people
   * actually have, which is "this entry was priced wrong, and I would like to price it". The rate
   * chain has always ranked a per-entry override above every stored tier, and capture has always
   * accepted one; what was missing was a way to say it, and a way to say it on an entry the firm
   * already holds. Both exist now.
   *
   * Typed in whole currency, held in ten-thousandths: the field is what a person says out loud
   * ("four fifty an hour"), and the wire unit is the contract's.
   */
  let rateDraft = $state<string | null>(null);

  /** The rate in force on the entry, in whole currency units, or null where nothing is charged. */
  const rateAmountNow = $derived(entry === null ? null : rateAmount(entry));

  /** What the rate field shows: what is being typed, else what the entry carries. */
  const rateFieldText = $derived(
    rateDraft ?? (rateAmountNow === null ? "" : String(rateAmountNow)),
  );

  /** The override this window would write, or undefined to leave the entry's rate alone. */
  const overrideRateE4 = $derived.by((): number | null | undefined => {
    if (rateDraft === null) return undefined;
    const trimmed = rateDraft.trim();
    // Emptied deliberately: clear the override and let the chain answer again.
    if (trimmed === "") return null;
    const typed = Number(trimmed.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(typed) || typed <= 0) return undefined;
    return Math.round(typed * 10_000);
  });

  /** Why a typed rate cannot be written, or null when it can. */
  const rateRefusal = $derived.by((): string | null => {
    if (rateDraft === null || rateDraft.trim() === "") return null;
    const typed = Number(rateDraft.trim().replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(typed) || typed <= 0) return "Enter the rate as an amount per hour";
    return null;
  });

  /*
   * DOCUMENTS PICKED FOR AN ENTRY THAT DOES NOT EXIST YET.
   *
   * Attaching is a write against an entry id, so until the entry is written there is nothing to
   * write against — which is why this tab used to answer "Save the entry first". That is a true
   * statement about the route and a wrong one about the work: a person writing up an afternoon has
   * the document open in front of them, and telling them to save, reopen and come back makes the
   * record window a two-visit form for a one-visit thought.
   *
   * So the picks are held here and applied the moment the entry exists. Nothing is written early
   * and nothing is invented: this is a list of intentions, and the save is still the only thing
   * that touches the record.
   *
   * THEY BELONG TO A MATTER, NOT JUST TO THE ENTRY. The picker offers one matter's documents, so
   * moving the entry to another matter before saving invalidates every pick — the files simply are
   * not on the new matter. That is what `stagedForMatter` watches.
   */
  let stagedFileIds = $state<readonly string[]>([]);
  let stagedForMatter = $state<string | null>(null);

  let workDateText = $state("");
  let durationText = $state("");
  let timekeeperUserId = $state("");
  let taskCodeId = $state<string | null>(null);
  let activityCodeId = $state<string | null>(null);

  /*
   * The firm's UTBMS codes, read the first time this window opens and not before: a person who
   * never opens a record should not pay for a catalogue they will not look at.
   */
  const codes = new UtbmsCatalogue();
  $effect(() => {
    if (!open) return;
    void codes.load(fetch);
  });
  /**
   * The matter a new entry is being written on, which the reader may still change.
   *
   * It is held here rather than read off the prop because the prop is where the entry STARTS: a
   * window opened from the firm-wide sheet starts on nothing, and the only way it can ever be saved
   * is for somebody to choose one in the field.
   */
  let chosenMatterId = $state<string | null>(null);
  /*
   * The task this time was worked on, and the matter's open tasks to choose it from.
   *
   * The link is optional and will be null on nearly every entry: time is captured against a MATTER,
   * and naming a task is an extra somebody chooses. What the field must never do is offer a task
   * from a different matter — the server refuses that, and offering it would be inviting a refusal
   * — so the options are read for whichever matter this entry is on and re-read when it changes.
   */
  /*
   * A combobox value is a string, and "no task" has to be expressible as one. The sentinel never
   * leaves this file: it is turned back into null the moment it is picked, so nothing downstream —
   * the save, the dirty check, the record — ever sees it.
   */
  const NO_TASK = "__none__";
  let chosenTaskId = $state<string | null>(null);
  let matterTasks = $state<readonly MatterTask[]>([]);
  let taskListOpen = $state(false);
  let billableChoice = $state("billable");
  let billingListOpen = $state(false);
  let saving = $state(false);
  let saveFailure = $state<string | null>(null);
  let printOpen = $state(false);

  /*
   * What the fields held when they were last seeded or last saved. Keeping it is what lets this
   * window answer honestly whether walking away would lose anything, so the shell asks the question
   * only when there is something to ask about — and it is what abandoning puts back.
   */
  const seeded = $state({
    description: "",
    memo: "",
    workDate: "",
    duration: "",
    timekeeperUserId: "",
    matterId: null as string | null,
    taskId: null as string | null,
    billing: "billable",
    taskCodeId: null as string | null,
    activityCodeId: null as string | null,
  });

  function rememberWhatIsInTheFields(): void {
    seeded.description = descriptionText;
    seeded.memo = memoText;
    seeded.workDate = workDateText;
    seeded.duration = durationText;
    seeded.timekeeperUserId = timekeeperUserId;
    seeded.matterId = chosenMatterId;
    seeded.taskId = chosenTaskId;
    seeded.billing = billableChoice;
    seeded.taskCodeId = taskCodeId;
    seeded.activityCodeId = activityCodeId;
  }

  /*
   * The fields are re-seeded from the record whenever the window opens on a different entry, and
   * never while it is being edited: a re-seed mid-edit would silently discard what somebody typed.
   */
  let seededFor = $state<string | null>(null);
  /** How many provisional codes this window has minted, so each fresh entry reads its own. */
  let provisionalSequence = $state(0);
  /** The tentative code a new entry is held under until the record answers with its real one. */
  let provisionalCode = $state<string | null>(null);
  $effect(() => {
    /*
     * A new entry started FROM something is a different seed from a new entry started from nothing,
     * so the prefill is part of what the window considers itself seeded for. Without that, opening a
     * duplicate over an already-open blank form would leave the blank form standing.
     */
    const identity =
      entry !== null ? entry.id : prefill === null ? "new" : `new-from:${JSON.stringify(prefill)}`;
    if (!open) {
      seededFor = null;
      return;
    }
    if (seededFor === identity) return;
    seededFor = identity;
    saveFailure = null;
    // The record is the first authority, a prefill the second, and an empty form the answer when
    // there is neither.
    const start = entry ?? prefill;
    descriptionText = start?.narrative ?? "";
    // The memo and the codes are the RECORD's, never a prefill's: duplicating an entry copies what
    // the new one is about, not the firm's private note on the old one.
    memoText = entry?.memo ?? "";
    taskCodeId = entry?.utbmsTaskCodeId ?? null;
    activityCodeId = entry?.utbmsActivityCodeId ?? null;
    workDateText = start?.workDate ?? civilDateOf(new Date());
    durationText =
      start === null || start.rawDurationMinutes === 0
        ? ""
        : formatDuration(start.rawDurationMinutes).clock;
    // Whether an unstarted entry's staff begins as the person creating it is the reader's own
    // setting, in the window's menu. A prefill or a record still wins: those name a person.
    timekeeperUserId =
      start?.timekeeperUserId ??
      (timePreferences.defaultStaffToSelf ? (sessionUserId ?? "") : "");
    chosenMatterId = entry?.matterId ?? matterId;
    chosenTaskId = entry?.taskId ?? null;
    billableChoice = start === null || start.billable ? "billable" : "nonbillable";
    // A new entry is held under a tentative code from the moment the window opens on it; the
    // firm's own number replaces it when the record answers.
    if (entry === null) {
      provisionalSequence += 1;
      provisionalCode = provisionalTimeCode(provisionalSequence);
    } else {
      provisionalCode = null;
    }
    // A different record means different documents: picks made for the last one do not follow.
    stagedFileIds = [];
    attachmentFailure = null;
    // The alternative ways of stating the duration are views of it, not facts about the record, so
    // they start clear and re-derive from whatever the entry actually holds.
    unitsDraft = null;
    spanFrom = "";
    spanTo = "";
    rateDraft = null;
    rememberWhatIsInTheFields();
  });

  /** Whether a restore is in flight, so the verb cannot be pressed twice. */
  let unvoiding = $state(false);

  /**
   * Put a voided entry back to draft.
   *
   * Two of the server's refusals are worth saying in the reader's own words rather than as a
   * status: an entry that was never voided (which usually means somebody else already restored it,
   * so the answer is to re-read), and one whose value became a cost, which is the void that has to
   * stay. Everything else is reported honestly as a failure that changed nothing.
   */
  async function restore(): Promise<void> {
    if (entry === null || unvoiding) return;
    unvoiding = true;
    saveFailure = null;
    const outcome = await unvoidTimeEntry(fetch, entry.id, writeKey());
    unvoiding = false;
    if (outcome.kind !== "ok") {
      saveFailure =
        outcome.kind === "problem" && outcome.problem.status === 409
          ? "This entry wasn't restored. It may no longer be voided, or its value was moved to a cost, and restoring it would charge for the same work twice."
          : "The entry was not restored. It is still voided on the record.";
      return;
    }
    // The listing carries the status, so the row and the panel follow the window; the history is
    // one event longer than it was.
    onSaved();
    await refreshAttachments();
  }

  /*
   * The matter's open tasks, re-read whenever the entry's matter changes. Open only: a done or
   * cancelled task is not work somebody is still putting time into, and offering one would be
   * offering to file today's hour under something the firm has finished with. A task already NAMED
   * on this entry stays selectable even if it has since been closed — the record says what it says,
   * and the field must be able to show it.
   *
   * A failed read leaves the field empty and disabled rather than failing the window: the entry is
   * the point and the task is an extra.
   */
  $effect(() => {
    const forMatter = chosenMatterId;
    if (forMatter === null) {
      matterTasks = [];
      return;
    }
    void listMatterTasks(fetch, forMatter, undefined, { rungs: OPEN_RUNGS }).then((outcome) => {
      matterTasks = outcome.kind === "ok" ? outcome.value.data : [];
    });
  });

  const taskName = $derived(
    chosenTaskId === null
      ? ""
      : (matterTasks.find((task) => task.id === chosenTaskId)?.title ?? "A task on this matter"),
  );

  const unsavedChanges = $derived(
    descriptionText !== seeded.description ||
      memoText !== seeded.memo ||
      workDateText !== seeded.workDate ||
      durationText !== seeded.duration ||
      timekeeperUserId !== seeded.timekeeperUserId ||
      chosenMatterId !== seeded.matterId ||
      billableChoice !== seeded.billing ||
      taskCodeId !== seeded.taskCodeId ||
      activityCodeId !== seeded.activityCodeId ||
      chosenTaskId !== seeded.taskId ||
      // Documents picked for an entry not yet written are work that walking away would lose, and
      // so is a rate somebody typed.
      stagedFileIds.length > 0 ||
      overrideRateE4 !== undefined,
  );

  /*
   * Abandoning. The window has already left its editing mode by the time this runs, so the work
   * here is putting the fields back where they were — and, for an entry that was being written from
   * nothing, closing: a new entry has no earlier state to fall back to, so leaving its fields and
   * leaving the window are the same act.
   */
  function forgetChanges(): void {
    descriptionText = seeded.description;
    memoText = seeded.memo;
    workDateText = seeded.workDate;
    durationText = seeded.duration;
    timekeeperUserId = seeded.timekeeperUserId;
    chosenMatterId = seeded.matterId;
    billableChoice = seeded.billing;
    taskCodeId = seeded.taskCodeId;
    activityCodeId = seeded.activityCodeId;
    stagedFileIds = [];
    attachmentFailure = null;
    unitsDraft = null;
    spanFrom = "";
    spanTo = "";
    rateDraft = null;
    saveFailure = null;
    if (entry === null) open = false;
  }

  /**
   * The reserved value the "No code" row reports.
   *
   * A UTBMS code identifier is minted as `utbmsCode_…`, so this can never collide with one; it is
   * spelled here once rather than at each place that compares against it.
   */
  const NO_CODE_VALUE = "no-code";
  /*
   * WHAT "NO CODE" IS CALLED, AND WHY IT IS ALWAYS THERE. Every firm gets this row, whether it
   * codes its time or not: a firm with nothing turned on then has a field that works and a value
   * that is true, instead of a disabled control under a sentence explaining its own emptiness.
   * It is also the field's RESTING reading rather than a blank — an empty box says "somebody has
   * not filled this in yet", and (None) says "this entry carries no code", which is the fact.
   */
  const NO_CODE_LABEL = "(None)";
  /** Which code field is being typed into, by field id, or null while neither is. */
  let codeSearching = $state<string | null>(null);
  let codeListOpen = $state<string | null>(null);
  let codeQuery = $state("");

  const matchingCodes = (set: UtbmsCatalogue["task"]): readonly UtbmsCode[] => {
    const wanted = codeQuery.trim().toLowerCase();
    if (wanted === "") return set.available;
    return set.available.filter(
      (code) =>
        code.code.toLowerCase().includes(wanted) || code.label.toLowerCase().includes(wanted),
    );
  };

  /**
   * How a code reads when the catalogue cannot name it.
   *
   * The listing serves the code and its label ON THE ENTRY, so a record whose catalogue read was
   * refused still says what the entry carries — the field falls back to the record rather than
   * showing an identifier or a blank, either of which would read as "no code".
   */
  const recordedCodeText = (label: string, chosen: string | null): string => {
    if (chosen === null || entry === null) return "";
    const isCategory = label === "Category";
    const code = isCategory ? entry.utbmsTaskCode : entry.utbmsActivityCode;
    const codeLabel = isCategory ? entry.utbmsTaskLabel : entry.utbmsActivityLabel;
    if (code === null || code === undefined || code === "") return "";
    return codeLabel === null || codeLabel === undefined || codeLabel === ""
      ? code
      : `${code} · ${codeLabel}`;
  };

  /*
   * ---------------------------------------------------------------------------------------------
   * THE ENTRY'S HISTORY AND ITS FILES, each read when the window opens on a record that has one.
   *
   * Both are per-entry reads and neither is made for a new entry, which has no history and nothing
   * attached: a window opened to write one must not spend two requests establishing that.
   */
  let events = $state<readonly TimeEntryEvent[] | null>(null);
  let attachments = $state<readonly TimeEntryAttachment[] | null>(null);
  /** The matter's own documents, so the attach picker offers what is actually there to point at. */
  let matterFiles = $state<readonly MatterFile[] | null>(null);
  let attachmentFailure = $state<string | null>(null);
  let fileQuery = $state("");
  let fileListOpen = $state(false);
  /** Which entry these three were read for, so re-opening on another one re-reads rather than lies. */
  let readFor = $state<string | null>(null);

  $effect(() => {
    const record = open ? entry : null;
    if (record === null) {
      readFor = null;
      events = null;
      attachments = null;
      return;
    }
    if (readFor === record.id) return;
    readFor = record.id;
    events = null;
    attachments = null;
    attachmentFailure = null;
    void (async () => {
      const [history, attached] = await Promise.all([
        listTimeEntryEvents(fetch, record.id),
        listTimeEntryAttachments(fetch, record.id),
      ]);
      if (readFor !== record.id) return;
      // A failed read settles as an empty list: the rail and the attachment list each say what
      // that means in their own words, and neither is the subject of this window.
      events = history.kind === "ok" ? history.value.data : [];
      attachments = attached.kind === "ok" ? attached.value.data : [];
    })();
    void (async () => {
      const outcome = await listMatterFiles(fetch, record.matterId);
      if (readFor !== record.id) return;
      matterFiles = outcome.kind === "ok" ? outcome.value.data : [];
    })();
  });

  /*
   * The same read for an entry that is not written yet, keyed on the matter the reader has CHOSEN
   * rather than one the record names — on a firm-wide sheet a new entry starts on no matter at all,
   * and the picker has nothing to offer until one is picked. Re-picking re-reads, and drops the
   * picks made against the matter being left: those documents are not on the new one.
   */
  $effect(() => {
    if (!open || entry !== null) return;
    const forMatter = chosenMatterId;
    if (stagedForMatter !== forMatter) {
      stagedForMatter = forMatter;
      stagedFileIds = [];
      attachmentFailure = null;
      matterFiles = null;
    }
    if (forMatter === null) return;
    void (async () => {
      const outcome = await listMatterFiles(fetch, forMatter);
      if (chosenMatterId !== forMatter) return;
      matterFiles = outcome.kind === "ok" ? outcome.value.data : [];
    })();
  });

  /** The staged picks as documents, in the order they were picked. */
  const stagedFiles = $derived.by((): readonly MatterFile[] =>
    stagedFileIds.flatMap((fileId) => {
      const file = (matterFiles ?? []).find((candidate) => candidate.id === fileId);
      return file === undefined ? [] : [file];
    }),
  );

  /** The matter's documents this entry does not already point at. */
  const attachableFiles = $derived.by((): readonly MatterFile[] => {
    const already = new Set([
      ...(attachments ?? []).map((attachment) => attachment.fileId),
      ...stagedFileIds,
    ]);
    const wanted = fileQuery.trim().toLowerCase();
    return (matterFiles ?? [])
      .filter((file) => !already.has(file.id))
      .filter((file) => wanted === "" || file.name.toLowerCase().includes(wanted));
  });

  async function attachFile(fileId: string): Promise<void> {
    attachmentFailure = null;
    if (entry === null) {
      // Nothing to write against yet: remember the pick and let the save apply it.
      if (!stagedFileIds.includes(fileId)) stagedFileIds = [...stagedFileIds, fileId];
      return;
    }
    const outcome = await attachTimeEntryFile(fetch, entry.id, fileId, writeKey());
    if (outcome.kind !== "ok") {
      attachmentFailure =
        "The file was not attached. The entry and the document are both unchanged.";
      return;
    }
    await refreshAttachments();
    // The listing carries the count, so the row and the panel follow the record window.
    onSaved();
  }

  async function detachFile(fileId: string): Promise<void> {
    attachmentFailure = null;
    if (entry === null) {
      stagedFileIds = stagedFileIds.filter((staged) => staged !== fileId);
      return;
    }
    const outcome = await detachTimeEntryFile(fetch, entry.id, fileId, writeKey());
    if (outcome.kind !== "ok") {
      attachmentFailure = "The file was not detached. It is still attached to this entry.";
      return;
    }
    await refreshAttachments();
    onSaved();
  }

  async function refreshAttachments(): Promise<void> {
    if (entry === null) return;
    const outcome = await listTimeEntryAttachments(fetch, entry.id);
    if (outcome.kind === "ok") attachments = outcome.value.data;
    // Attaching and detaching are both recorded events, so the rail re-reads with them.
    const history = await listTimeEntryEvents(fetch, entry.id);
    if (history.kind === "ok") events = history.value.data;
  }

  let staffQuery = $state("");
  /** Whether the reader is searching rather than reading the chosen name. */
  let staffSearching = $state(false);
  /** The list is a controlled open: arriving in the field shows everything, typing narrows. */
  let staffListOpen = $state(false);
  const activeMembers = $derived(members.filter((member) => member.status === "active"));
  const matchingMembers = $derived(
    staffQuery.trim() === ""
      ? activeMembers
      : activeMembers.filter((member) =>
          member.displayName.toLowerCase().includes(staffQuery.trim().toLowerCase()),
        ),
  );

  function pickTimekeeper(picked: string | string[]): void {
    timekeeperUserId = Array.isArray(picked) ? (picked[0] ?? "") : picked;
  }

  /*
   * The billing dispositions the record is designed to carry. The two the model actually holds are
   * live; the one that needs a disposition beyond a boolean stays visible, refused, saying what it
   * waits on — a choice that exists and is not offered is a choice a reader cannot know about.
   *
   * THERE IS NO FOURTH. A "no charge, on the bill at nothing" row sat here and was withdrawn: it
   * is non-billable under a longer name. Both mean the client is charged nothing for this work,
   * both leave the entry on the ledger carrying no value, and the only difference anybody could
   * name was whether the line is printed — which is a question about what a bill shows, not about
   * what this entry is. Two rows for one disposition make a member choose between them, and there
   * is no right answer to that choice.
   */
  const BILLING_CHOICES = [
    { value: "billable", label: "Billable, next bill", waitsOn: null },
    { value: "nonbillable", label: "Non-billable", waitsOn: null },
    { value: "hold", label: "Billable, hold", waitsOn: gapReason("billingDisposition") },
  ] as const;

  const billingLabel = $derived(
    BILLING_CHOICES.find((choice) => choice.value === billableChoice)?.label ?? "",
  );

  function pickBilling(picked: string | string[]): void {
    const next = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    if (next === "billable" || next === "nonbillable") billableChoice = next;
  }
  const timekeeperName = $derived(
    entry !== null && !editing
      ? timekeeperOf(entry)
      : (activeMembers.find((member) => member.userId === timekeeperUserId)?.displayName ?? ""),
  );

  /*
   * THE SAME DURATION, THREE WAYS OF SAYING IT.
   *
   * `durationText` stays the one source of truth — it is what the save reads, and it is what the
   * hours field binds to. The other two are PROJECTIONS of it that can also be typed into: while a
   * person is typing in one, that field shows their keystrokes (the draft), and the moment what
   * they typed makes sense it is written back into `durationText`, which is what makes the other
   * fields follow. This is the same rest-versus-typing split the code and staff fields already use;
   * without it, a half-typed "1." would be parsed, rounded and re-rendered under the cursor.
   */
  let unitsDraft = $state<string | null>(null);
  let spanFrom = $state("");
  let spanTo = $state("");

  const workedMinutes = $derived(parseDurationText(durationText));
  /** The billed figure: the worked time rounded on the firm's own policy. */
  const billedMinutes = $derived(
    workedMinutes === null ? null : roundToIncrement(workedMinutes, rounding),
  );
  const billable = $derived(billableChoice === "billable");

  /** The worked time counted in the firm's billing increments, at rest. */
  const unitsDisplay = $derived(
    unitsDraft ??
      (workedMinutes === null
        ? ""
        : String(Math.round((workedMinutes / rounding.incrementMinutes) * 100) / 100)),
  );

  /** A duration typed as a count of units, written back as the canonical hours text. */
  function typeUnits(text: string): void {
    unitsDraft = text;
    const count = Number(text.trim());
    if (text.trim() === "" || !Number.isFinite(count) || count < 0) return;
    durationText = minutesAsText(Math.round(count * rounding.incrementMinutes));
  }

  /** A duration typed as the two times it happened between. */
  function typeSpan(from: string, to: string): void {
    spanFrom = from;
    spanTo = to;
    const minutes = parseTimeSpan(from, to);
    if (minutes !== null) durationText = minutesAsText(minutes);
  }

  /** Minutes in the clock form the hours field holds them in. */
  function minutesAsText(minutes: number): string {
    return formatDuration(minutes).clock;
  }

  /** The modes on screen, always in the one order the fields are laid out in. */
  const entryModes = $derived(TIME_ENTRY_MODES.filter((mode) => timePreferences.showsEntryMode(mode)));
  /** The one that leads the arithmetic sentence; the rest follow on their own row. */
  const leadMode = $derived(entryModes[0] ?? "hours");

  /** Where a resolved rate came from, in the words the chain uses. */
  const RATE_SOURCE_WORDS: Readonly<Record<string, string>> = {
    override: "a per-entry override",
    matter: "this matter's own rate",
    client: "the client's rate",
    timekeeper: "the timekeeper's standard rate",
    role: "the role's default",
    card_default: "the rate card's default",
  };

  /*
   * The rate as a sentence, for the read-only record. Non-billable internal time has no rate at
   * all, which is a statement that nothing is charged and not a rate of zero.
   */
  const rateLine = $derived.by((): string => {
    const amount = entry === null ? null : rateAmount(entry);
    if (amount === null) return billable ? "—" : "No charge";
    return formatMoney(amount, { currency: entry?.currency ?? "USD" });
  });
  const rateExplanation = $derived.by((): string => {
    if (entry === null) return "The rate resolves when the entry is written.";
    if (entry.rateE4 === null || entry.rateE4 === undefined) {
      return "Non-billable time carries no rate: nothing is charged.";
    }
    const source = RATE_SOURCE_WORDS[entry.rateSource ?? ""] ?? "the rate chain";
    return `Resolved from ${source} on ${entry.workDate}, and frozen there. Changing a rate card later never re-rates an entry.`;
  });

  /** The amount the window can state. Without a served rate it can only repeat what was recorded. */
  const amountLine = $derived.by((): string => {
    if (!billable) return "No charge";
    if (entry?.amountMinor != null) {
      return formatMoney(entry.amountMinor / 100, { currency: entry.currency });
    }
    return "—";
  });

  /*
   * Why the entry cannot be written as it stands. The matter is the first of the reasons on a new
   * entry, because capture takes one: an advance control validates before it enables, so the field
   * says what is missing rather than the server answering a refusal the window could have named.
   */
  const refusal = $derived.by((): string | null => {
    if (!editing) return null;
    if (creating && chosenMatterId === null) return "Choose the matter this time belongs to";
    if (rateRefusal !== null) return rateRefusal;
    return draftRefusal({ durationText, description: descriptionText });
  });

  /** Why the change cannot be committed as it stands. A save in flight is one of those reasons. */
  const saveRefusal = $derived(saving ? "Saving this entry." : (refusal ?? undefined));

  const heading = $derived(creating ? "Log Time" : editing ? "Edit Time Entry" : "Time Entry");

  /* The lock the record is under, in the chain's own words. */
  const lockLine = $derived.by((): string | null => {
    if (entry === null) return null;
    if (entry.status === "draft") {
      const verdict = canWorkDraft(entry);
      return verdict.allowed ? null : verdict.reason;
    }
    return statusEntry(entry.status).meaning;
  });

  /*
   * Why the Edit control refuses. It gates ENTRY into the fields, not the fields themselves — an
   * entry being written from nothing is already in them, and its own Edit control is the one thing
   * it cannot press, because there is no earlier version of it to go back and read.
   */
  const editRefusal = $derived.by((): string | undefined => {
    if (entry === null) return "A new entry has no history yet.";
    if (entry.status !== "draft") return statusEntry(entry.status).meaning;
    const verdict = canWorkDraft(entry);
    return verdict.allowed ? undefined : verdict.reason;
  });

  /** The matter in hand as it reads: the one chosen in the field, else whatever the caller named. */
  const chosenMatterName = $derived.by((): string => {
    const chosen = matters.find((matter) => matter.id === chosenMatterId);
    if (chosen !== undefined) return matterDisplay(chosen);
    return matterTitle ?? "";
  });

  const sheet = $derived(
    entry === null
      ? null
      : timeEntrySheet(entry, {
          matterTitle: chosenMatterName,
          money: (amount) => formatMoney(amount, { currency: entry.currency }),
          ...printSheetDates(),
          printedAt: formatInstant(new Date()),
        }),
  );

  async function save(andKeepGoing: boolean): Promise<void> {
    if (refusal !== null || saving) return;
    const minutes = parseDurationText(durationText);
    if (minutes === null) return;
    // The refusal above has already established a new entry has a matter; reading it into a
    // constant is what lets the type system agree, and what keeps a capture without one impossible.
    const writeToMatter = chosenMatterId;
    if (entry === null && writeToMatter === null) return;
    saving = true;
    saveFailure = null;
    // A changed matter on an entry the firm holds is a MOVE, and it is its own write: the patch
    // route does not carry a matter, because moving one is a cross-matter change with its own
    // refusals. It goes first, so a refused move never half-lands behind a successful edit.
    if (entry !== null && chosenMatterId !== null && chosenMatterId !== entry.matterId) {
      const moved = await refileTimeEntry(fetch, entry.id, chosenMatterId, writeKey());
      if (moved.kind !== "ok") {
        saving = false;
        saveFailure =
          moved.kind === "problem" && moved.problem.status === 409
            ? "This entry cannot be moved: it is past draft, on a bill, or claimed by one. Nothing was changed."
            : "The entry was not moved, so nothing else was saved either. It is unchanged.";
        return;
      }
    }
    const outcome =
      entry === null
        ? await createTimeEntry(
            fetch,
            {
              // The matter the reader chose in the field, never the one the window opened on: on a
              // firm-wide sheet those are two different answers.
              matterId: writeToMatter ?? "",
              timekeeperUserId,
              workDate: workDateText,
              rawDurationMinutes: minutes,
              narrative: descriptionText.trim(),
              billable,
              utbmsTaskCodeId: taskCodeId,
              utbmsActivityCodeId: activityCodeId,
              // Null clears rather than omits: a memo somebody emptied must be emptied on the
              // record, not left standing because the field went blank.
              memo: memoText.trim() === "" ? null : memoText,
              taskId: chosenTaskId,
              // Absent unless somebody actually typed a rate: an untouched field must not send a
              // null and clear a rate the chain had resolved perfectly well.
              ...(overrideRateE4 === undefined ? {} : { overrideRateE4 }),
            },
            writeKey(),
          )
        : await patchTimeEntry(
            fetch,
            entry.id,
            {
              narrative: descriptionText.trim(),
              rawDurationMinutes: minutes,
              workDate: workDateText,
              utbmsTaskCodeId: taskCodeId,
              utbmsActivityCodeId: activityCodeId,
              memo: memoText.trim() === "" ? null : memoText,
              taskId: chosenTaskId,
              ...(overrideRateE4 === undefined ? {} : { overrideRateE4 }),
            },
            writeKey(),
          );
    saving = false;
    if (outcome.kind !== "ok") {
      saveFailure =
        outcome.kind === "problem"
          ? `The entry was not saved. The server answered ${String(outcome.problem.status)}.`
          : "Couldn't connect. The entry wasn't saved.";
      return;
    }
    /*
     * THE PICKS BECOME ATTACHMENTS, NOW THAT THERE IS SOMETHING TO ATTACH THEM TO. This is the
     * whole of what staging deferred, and it runs only here — after the entry is on the record,
     * with the id the record answered with.
     *
     * A failure here is REPORTED AND NOT SWALLOWED, and it is a different fact from a failed save:
     * the entry exists and is correct, and some documents did not get linked to it. So the window
     * stays open saying exactly that, the listing is refreshed either way because the entry is
     * real, and the picks that DID land are dropped so that trying again cannot attach them twice.
     */
    // A create answers with the new entry's id; a change answers with the record it changed.
    const savedEntryId = "timeEntryId" in outcome.value ? outcome.value.timeEntryId : outcome.value.id;
    if (stagedFileIds.length > 0) {
      const stillWaiting: string[] = [];
      for (const fileId of stagedFileIds) {
        const attached = await attachTimeEntryFile(fetch, savedEntryId, fileId, writeKey());
        if (attached.kind !== "ok") stillWaiting.push(fileId);
      }
      stagedFileIds = stillWaiting;
      if (stillWaiting.length > 0) {
        onSaved();
        saveFailure =
          stillWaiting.length === 1
            ? "The entry was saved. One document was not attached to it: open the entry and attach it there."
            : `The entry was saved. ${String(stillWaiting.length)} documents were not attached to it: open the entry and attach them there.`;
        return;
      }
    }
    onSaved();
    if (andKeepGoing) {
      if (entry !== null) {
        // A change to an entry the firm holds landed; the next entry is a fresh one carrying the
        // context forward, and only the caller can swap the window onto it.
        onContinueNew?.({
          narrative: "",
          workDate: workDateText,
          rawDurationMinutes: 0,
          billable,
          timekeeperUserId,
        });
        return;
      }
      descriptionText = "";
      memoText = "";
      durationText = "";
      // The documents just attached belong to the entry that took them, not to the next one.
      stagedFileIds = [];
      unitsDraft = null;
      spanFrom = "";
      spanTo = "";
      rateDraft = null;
      // A fresh entry, a fresh tentative code: the one just saved took its own number with it.
      provisionalSequence += 1;
      provisionalCode = provisionalTimeCode(provisionalSequence);
      // The next entry starts from these fields, so they are what "unchanged" now means: without
      // this, the emptied form would read as unsaved work and the window would argue on the way out.
      rememberWhatIsInTheFields();
      return;
    }
    editing = false;
    open = false;
  }
</script>

{#snippet subtitle()}
  {#if entry === null}
    {#if provisionalCode !== null}
      <!-- The tentative code is visible from the first frame: an entry is a thing with a number
           from the moment somebody starts it, and the firm's own number replaces this on save. -->
      <span
        class="tabular-nums"
        title="A tentative code, held until the entry is saved. The firm's own entry number replaces it, minted on the matter."
      >
        Entry {provisionalCode}
      </span>
      <Badge variant="neutral">Tentative</Badge>
      <span aria-hidden="true">&middot;</span>
    {/if}
    <span>{chosenMatterName === "" ? "No matter chosen yet" : chosenMatterName}</span>
  {:else}
    <!-- The entry number is the subtitle, and the subtitle is its only home in this window: the
         record pane does not repeat it. An entry captured before the sequence existed carries
         none, and says that rather than showing a number nothing issued. -->
    <span
      class="tabular-nums"
      title={entry.entryNumber === null
        ? "This entry was captured before entry numbers existed. Nothing backfills one."
        : "The firm's entry number. It's never reused, even if the entry is voided."}
    >
      {entry.entryNumber === null ? "No entry number" : `Entry ${entry.entryNumber}`}
    </span>
    <span aria-hidden="true">&middot;</span>
    <span>{chosenMatterName}</span>
    <Badge {...statusBadgeAttributes(entry.status)}>{statusEntry(entry.status).label}</Badge>
  {/if}
{/snippet}

<!--
  ONE WAY OF STATING A DURATION, RENDERED. Three modes, one snippet, for the same reason the two
  code fields are one snippet: two copies of a field is how the two start behaving differently.
  Each writes back into the single duration the entry records, so whichever a person types in, the
  others are already showing the same time.
-->
{#snippet workedField(
  mode: (typeof TIME_ENTRY_MODES)[number],
  fieldId: string,
  readOnly: boolean,
)}
  {#if mode === "span"}
    <span class="text-xs text-text-subtle">Worked Between</span>
    <div class="flex items-center gap-4">
      <Input
        id={fieldId}
        class="w-96"
        placeholder="9:00"
        title="When the work started. Typed as you say it: 9, 9:30, 9:30 am."
        aria-label="Started at"
        disabled={readOnly}
        value={spanFrom}
        oninput={(event) => typeSpan(event.currentTarget.value, spanTo)}
      />
      <span class="text-text-subtle" aria-hidden="true">&ndash;</span>
      <Input
        class="w-96"
        placeholder="10:30"
        title="When it finished. An end earlier than the start is read as crossing midnight."
        aria-label="Finished at"
        disabled={readOnly}
        value={spanTo}
        oninput={(event) => typeSpan(spanFrom, event.currentTarget.value)}
      />
    </div>
  {:else if mode === "units"}
    <Label for={fieldId}>Units</Label>
    <Input
      id={fieldId}
      class="w-96"
      placeholder="Units"
      title={`Counted in the firm's own billing increment: one unit is ${formatDuration(rounding.incrementMinutes).text}.`}
      disabled={readOnly}
      value={unitsDisplay}
      oninput={(event) => typeUnits(event.currentTarget.value)}
      onblur={() => (unitsDraft = null)}
    />
  {:else}
    <Label for={fieldId}>Time Worked</Label>
    <Input
      id={fieldId}
      placeholder="Time Worked"
      title="Time worked, typed either way: 1:30 or 1.5"
      disabled={readOnly}
      bind:value={durationText}
    />
  {/if}
{/snippet}

{#snippet unservedField(label: string, gap: keyof typeof TIME_LEDGER_GAPS, fieldName: string)}
  <div class="flex flex-col gap-4">
    <Label>{label}</Label>
    <SoonAffordance class="min-w-0" reason={gapReason(gap)}>
      {#snippet control(soon)}
        <Combobox.Root type="single" disabled>
          <Combobox.Input class="min-w-0 flex-1" {fieldName} {...soon} />
        </Combobox.Root>
      {/snippet}
    </SoonAffordance>
  </div>
{/snippet}

<!--
  ONE UTBMS FIELD, RENDERED TWICE. Category and Activity are the same control over two ABA sets, so
  they are one snippet: two copies of a typable combobox is how the two fields start behaving
  differently. The field shows what it holds at rest and arriving in it starts a fresh search; a
  "No code" row takes the code back off, because clearing by deleting text is a gesture most people
  never find.

  A CATALOGUE THAT COULD NOT BE READ COSTS THE PICKER AND NOT THE FIELD. The listing serves the code
  and its label on the entry itself, so the record still reads correctly; what it cannot do is offer
  a choice, and the line under the field says which of the three reasons applies.
-->
{#snippet codeField(
  label: string,
  fieldId: string,
  set: UtbmsCatalogue["task"],
  chosen: string | null,
  onpick: (identifier: string | null) => void,
  readOnly: boolean,
)}
  {@const refusal = set.pickerRefusal}
  {@const recorded =
    set.labelFor(chosen) === "" ? recordedCodeText(label, chosen) : set.labelFor(chosen)}
  {@const committed = recorded === "" ? NO_CODE_LABEL : recorded}
  <div class="flex flex-col gap-4">
    <Label for={fieldId}>{label}</Label>
    {#if readOnly}
      <Input id={fieldId} value={committed} disabled placeholder={label} />
    {:else}
      <Combobox.Root
        type="single"
        disabled={refusal !== null && chosen === null}
        items={[
          { value: NO_CODE_VALUE, label: NO_CODE_LABEL },
          ...set.available.map((code) => ({
            value: code.id,
            label: `${code.code} · ${code.label}`,
          })),
        ]}
        value={chosen ?? ""}
        inputValue={codeSearching === fieldId ? codeQuery : committed}
        open={codeListOpen === fieldId}
        onValueChange={(picked) => {
          const value = Array.isArray(picked) ? (picked[0] ?? "") : picked;
          codeSearching = null;
          codeQuery = "";
          onpick(value === "" || value === NO_CODE_VALUE ? null : value);
        }}
        onOpenChange={(opened) => {
          codeListOpen = opened ? fieldId : null;
          if (!opened) {
            codeSearching = null;
            codeQuery = "";
          }
        }}
      >
        <Combobox.Input
          id={fieldId}
          fieldName={label}
          autocomplete="off"
          onfocus={() => {
            codeSearching = fieldId;
            codeQuery = "";
            codeListOpen = fieldId;
          }}
          onclick={() => (codeListOpen = fieldId)}
          oninput={(event) => {
            codeSearching = fieldId;
            codeQuery = event.currentTarget.value;
            codeListOpen = fieldId;
          }}
        />
        <Combobox.Content>
          <Combobox.Item value={NO_CODE_VALUE} label={NO_CODE_LABEL} />
          {#each matchingCodes(set) as code (code.id)}
            <Combobox.Item value={code.id} label={`${code.code} · ${code.label}`} />
          {/each}
        </Combobox.Content>
      </Combobox.Root>
    {/if}
    {#if refusal !== null}
      <p class="text-xs text-text-subtle">{refusal}</p>
    {/if}
  </div>
{/snippet}

<!--
  ONE pane, both modes. The window hands it whether the fields are open; the values and the fields
  are the same rows in the same order at the same width, which is what stops a reader losing their
  place the moment they press Edit.
-->
{#snippet record({ editing: fieldsOpen }: { editing: boolean })}
  {@const readOnly = !fieldsOpen}
  <!--
    The field rows break against THIS PANE's width, not the viewport's. A viewport breakpoint was
    the wrong ruler here and it showed: the pane is one column of a window that has its own measure,
    so a wide screen holding a narrow pane still laid three fields across a strip too small for
    their labels, and the labels ran into each other. A container query asks the only question that
    decides whether three fields fit, which is how wide the thing holding them is.
  -->
  <div class="@container flex flex-col gap-16">
    {#if saveFailure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Not Saved</Alert.Title>
        <Alert.Description>{saveFailure}</Alert.Description>
      </Alert.Root>
    {/if}

    <div class="flex flex-col gap-4">
      <Label for="time-record-description">Description</Label>
      <!-- No resize handle, deliberately: the window holds its size, so a long description scrolls
           inside its own field and the pane scrolls past it — the entry never grows under it. -->
      <Textarea
        id="time-record-description"
        class="resize-none"
        rows={3}
        placeholder="Description"
        title="Description"
        disabled={readOnly}
        bind:value={descriptionText}
      />
    </div>

    <!--
      THE INTERNAL MEMO SITS UNDER THE DESCRIPTION BECAUSE THEY ARE THE SAME ACT. Both are what a
      person writes about this work; they differ only in who reads them, and the pair reads as one
      thought when the private half follows the public one. Down by the arithmetic it was a
      stranded field a reader met after they had finished with the entry.

      It is shown on a read-only record too: internal is not the same as hidden. And it is absent
      by construction from everything client-facing — the print sheet names every field it prints
      rather than spreading the entry, so this text has no way to reach paper.

      NO BADGE. It wore an "Internal" chip beside its label, which said in a second voice what the
      word Internal in the label had already said.
    -->
    <div class="flex flex-col gap-4" data-internal-only="true">
      <Label for="time-record-memo">Internal Memo</Label>
      <Textarea
        id="time-record-memo"
        class="resize-none"
        rows={2}
        placeholder="Internal Memo"
        title="The firm's own note on this entry. It never reaches a bill, an export or a client."
        disabled={readOnly}
        spellcheck={true}
        bind:value={memoText}
      />
    </div>

    <div class="grid gap-12 @md:grid-cols-3">
      <div class="flex flex-col gap-4">
        <!-- The product's own calendar, not the browser's: one themed picker on every surface. -->
        <DatePicker
          label="Work Date"
          value={workDateText === "" ? undefined : parseDate(workDateText)}
          disabled={readOnly}
          onValueChange={(picked) => (workDateText = picked === undefined ? "" : picked.toString())}
        />
      </div>

      <!--
        A NEW entry's matter is a real choice, because capture takes one and nothing has been
        written yet. An entry the firm already holds is a different question: nothing in the
        contract moves one between matters, so that field stays refused and says what it waits on.
      -->
      <!--
        THE MATTER IS THE RECORD'S, AND A MISFILED ENTRY MOVES. On a new entry it is the choice that
        lets the entry be written at all; on a draft the firm already holds, choosing another matter
        moves it there — its number, its memo, its codes, its files and its history come with it,
        and its rate and rounding are re-read on the matter it moved to, because both resolve
        through the matter. Past draft the field states where the entry is and refuses: an approved
        or billed entry is evidence, and the answer there is a void and a fresh record.
      -->
      <div class="flex flex-col gap-4">
        <Label for="time-record-matter">Matter</Label>
        <MatterPicker
          inputId="time-record-matter"
          {matters}
          value={chosenMatterId}
          capped={mattersCapped}
          disabled={readOnly}
          title={creating
            ? "The matter this time is for. Type its number or name."
            : "Where this time belongs. Picking another matter moves the entry there, with its number, its note and its files."}
          onpick={(picked) => (chosenMatterId = picked)}
        />
      </div>

      <div class="flex flex-col gap-4">
        <Label for="time-record-staff">Staff</Label>
        {#if readOnly}
          <Input id="time-record-staff" value={timekeeperName} disabled placeholder="Staff" />
        {:else}
          <Combobox.Root
            type="single"
            value={timekeeperUserId}
            inputValue={staffSearching ? staffQuery : timekeeperName}
            open={staffListOpen}
            onValueChange={pickTimekeeper}
            onOpenChange={(opened) => {
              staffListOpen = opened;
              if (!opened) {
                staffSearching = false;
                staffQuery = "";
              }
            }}
          >
            <!-- Arriving in the field shows the whole list at once — a dropdown a person has to
                 type at before it says anything is a dropdown they cannot browse. -->
            <Combobox.Input
              id="time-record-staff"
              fieldName="Staff"
              title="The timekeeper. The record keeps the name as it was when entered."
              onfocus={() => {
                staffSearching = true;
                staffQuery = "";
                staffListOpen = true;
              }}
              onclick={() => (staffListOpen = true)}
              oninput={(event) => {
                staffSearching = true;
                staffQuery = event.currentTarget.value;
                staffListOpen = true;
              }}
            />
            <Combobox.Content>
              {#each matchingMembers as member (member.userId)}
                <Combobox.Item value={member.userId} label={member.displayName} />
              {/each}
            </Combobox.Content>
          </Combobox.Root>
        {/if}
      </div>
    </div>

    <div class="grid gap-12 @md:grid-cols-3">
      <div class="flex flex-col gap-4">
        <Label for="time-record-billing">Billing</Label>
        <Combobox.Root
          type="single"
          value={billableChoice}
          inputValue={billingLabel}
          disabled={readOnly}
          open={billingListOpen}
          onValueChange={pickBilling}
          onOpenChange={(opened) => (billingListOpen = opened)}
        >
          <Combobox.Input
            id="time-record-billing"
            fieldName="Billing"
            readonly
            onfocus={() => (billingListOpen = true)}
            onclick={() => (billingListOpen = true)}
          />
          <Combobox.Content>
            {#each BILLING_CHOICES as choice (choice.value)}
              <Combobox.Item
                value={choice.value}
                label={choice.label}
                disabled={choice.waitsOn !== null}
                title={choice.waitsOn === null
                  ? undefined
                  : `Not built yet. Waiting on ${choice.waitsOn}.`}
              />
            {/each}
          </Combobox.Content>
        </Combobox.Root>
      </div>

      {@render codeField(
        "Category",
        "time-record-category",
        codes.task,
        taskCodeId,
        (picked) => (taskCodeId = picked),
        readOnly,
      )}
      {@render codeField(
        "Activity Code",
        "time-record-activity",
        codes.activity,
        activityCodeId,
        (picked) => (activityCodeId = picked),
        readOnly,
      )}
    </div>

    <!--
      THE TASK THIS TIME WAS WORKED ON, and it is genuinely optional: most entries name none, and
      the field's first option is the one that says so. Only this matter's OPEN tasks are offered,
      because a task on another matter is refused by the server and a finished task is not work
      somebody is still putting time into. Before a new entry has a matter there is nothing to
      offer, so the field says that rather than presenting an empty list.
    -->
    <div class="grid gap-12 @md:grid-cols-3">
      <div class="flex flex-col gap-4">
        <Label for="time-record-task">Task</Label>
        {#if readOnly}
          <Input
            id="time-record-task"
            value={chosenTaskId === null ? "No task" : taskName}
            disabled
            placeholder="Task"
          />
        {:else if chosenMatterId === null}
          <Input id="time-record-task" value="" disabled placeholder="Task" />
          <!-- The reason stays on screen. Ghost text would vanish at the moment it is needed, and
               this is a condition the reader has to act on rather than a name for the field. -->
          <span class="text-xs text-text-muted">
            A task belongs to a matter, so there is nothing to choose from until this entry has one.
          </span>
        {:else}
          <Combobox.Root
            type="single"
            value={chosenTaskId ?? NO_TASK}
            inputValue={chosenTaskId === null ? "No task" : taskName}
            open={taskListOpen}
            onValueChange={(picked) => (chosenTaskId = picked === NO_TASK ? null : picked)}
            onOpenChange={(opened) => (taskListOpen = opened)}
          >
            <Combobox.Input
              id="time-record-task"
              fieldName="Task"
              readonly
              title="The task on this matter this time was for. Optional."
              onfocus={() => (taskListOpen = true)}
              onclick={() => (taskListOpen = true)}
            />
            <Combobox.Content>
              <Combobox.Item value={NO_TASK} label="No task" />
              {#each matterTasks as task (task.id)}
                <Combobox.Item value={task.id} label={task.title} />
              {/each}
            </Combobox.Content>
          </Combobox.Root>
        {/if}
      </div>
    </div>

    <!--
      Worked, rounded to billed, times rate, equals amount: one relationship on one line. The
      sentence does not change shape when a reader changes how they enter time — whichever way they
      chose simply becomes its leading term, and any others they kept are on the row beneath.
    -->
    <div class="flex flex-wrap items-end gap-8">
      <div class="flex min-w-0 flex-1 flex-col gap-4">
        {@render workedField(leadMode, "time-record-worked", readOnly)}
      </div>
      <span class="pb-8 text-text-subtle" aria-hidden="true">&rarr;</span>
      <div class="flex flex-col gap-4">
        <span class="text-xs text-text-subtle">Billed</span>
        <span class="pb-8 tabular-nums" title={roundingLine}>
          {#if billedMinutes === null}
            —
          {:else}
            {formatDuration(billedMinutes).decimal}
            <span class="text-xs text-text-muted">{formatDuration(billedMinutes).clock}</span>
          {/if}
        </span>
      </div>
      <span class="pb-8 text-text-subtle" aria-hidden="true">&times;</span>
      <div class="flex min-w-0 flex-1 flex-col gap-4">
        <Label for="time-record-rate">Rate</Label>
        {#if readOnly || !billable}
          <!-- Nothing is charged on non-billable time, so there is no rate to set: the line says
               so rather than offering a field whose value could never be used. -->
          <span class="pb-8 tabular-nums" title={rateExplanation}>{rateLine}</span>
        {:else}
          <Input
            id="time-record-rate"
            placeholder="Rate"
            title={`${rateExplanation} A rate typed here applies to this entry only. Clear it to use the usual rate.`}
            value={rateFieldText}
            oninput={(event) => (rateDraft = event.currentTarget.value)}
          />
        {/if}
      </div>
      <span class="pb-8 text-text-subtle" aria-hidden="true">=</span>
      <div class="flex flex-col gap-4">
        <span class="text-xs text-text-subtle">Amount</span>
        <span class="pb-8 tabular-nums">{amountLine}</span>
      </div>
    </div>

    <!--
      The other ways of saying the same duration, for a reader who kept more than one. They are
      live in both directions: type in any of them and the rest follow, because all of them are
      views of the one number the entry actually records.
    -->
    {#if entryModes.length > 1}
      <div class="flex flex-wrap items-end gap-12">
        {#each entryModes.slice(1) as mode (mode)}
          <div class="flex min-w-0 flex-col gap-4">
            {@render workedField(mode, `time-record-worked-${mode}`, readOnly)}
          </div>
        {/each}
      </div>
    {/if}

    {#if rateRefusal !== null}
      <p class="text-xs text-text-danger">{rateRefusal}</p>
    {/if}
    <p class="text-xs text-text-subtle">{roundingLine}</p>

  </div>
{/snippet}

<!--
  THE WHOLE TAB IS THE LIST OF WHAT THIS ENTRY POINTS AT. An attachment REFERENCES a document that
  is already in the matter — attaching never copies bytes and detaching never deletes the file, it
  removes the link. That is why the door is a picker over the matter's own documents rather than an
  upload: uploading into the matter is the file manager's job, and a second uploader here would be
  a second place a document can arrive from.
-->
{#snippet attachmentsTab()}
  <div class="flex h-full min-h-0 flex-col gap-8">
    {#if attachmentFailure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>Nothing Changed</Alert.Title>
        <Alert.Description>{attachmentFailure}</Alert.Description>
      </Alert.Root>
    {/if}
    {#if entry === null && chosenMatterId === null}
      <p class="text-sm text-text-muted">
        Choose the matter first: the documents offered here are that matter's own.
      </p>
    {:else}
      <Combobox.Root
        type="single"
        items={attachableFiles.map((file) => ({ value: file.id, label: file.name }))}
        value=""
        inputValue={fileQuery}
        open={fileListOpen}
        onValueChange={(picked) => {
          const value = Array.isArray(picked) ? (picked[0] ?? "") : picked;
          if (value !== "") void attachFile(value);
          fileQuery = "";
          fileListOpen = false;
        }}
        onOpenChange={(opened) => {
          fileListOpen = opened;
          if (!opened) fileQuery = "";
        }}
      >
        <Combobox.Input
          fieldName="From the Matter"
          autocomplete="off"
          onfocus={() => (fileListOpen = true)}
          onclick={() => (fileListOpen = true)}
          oninput={(event) => {
            fileQuery = event.currentTarget.value;
            fileListOpen = true;
          }}
        />
        <Combobox.Content>
          {#each attachableFiles as file (file.id)}
            <Combobox.Item value={file.id} label={file.name} />
          {/each}
          <!-- The heading sits inside a group: a bare one has no identity to label and throws when
               the listbox opens, which is invisible until somebody clicks the field. -->
          {#if attachableFiles.length === 0}
            <Combobox.Group>
              <Combobox.GroupHeading>
                {matterFiles === null
                  ? "Reading the matter's documents"
                  : "All documents on this matter are already attached."}
              </Combobox.GroupHeading>
            </Combobox.Group>
          {/if}
        </Combobox.Content>
      </Combobox.Root>

      {#if entry === null}
        <!--
          THE PICKS, BEFORE THERE IS A RECORD TO HANG THEM ON. They read exactly like attachments,
          because that is what saving makes them; what differs is the one line under the list
          saying when it happens, so nobody believes a document has been linked to something that
          does not exist yet.
        -->
        {#if stagedFiles.length === 0}
          <div
            class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border-default p-16 text-center"
          >
            <p class="text-sm text-text-muted">Nothing is attached to this entry.</p>
            <p class="text-xs text-text-subtle">
              Pick one of the matter's documents above. The file stays where it is.
            </p>
          </div>
        {:else}
          <ul class="mc-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {#each stagedFiles as file (file.id)}
              <li class="flex items-center gap-8 rounded-md border border-border-default p-8">
                <Paperclip class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Remove this document from the entry being written. It stays in the matter's documents."
                  aria-label="Remove {file.name}"
                  onclick={() => void detachFile(file.id)}
                >
                  <X class="size-16" aria-hidden="true" />
                </Button>
              </li>
            {/each}
          </ul>
          <p class="text-xs text-text-subtle">
            {stagedFiles.length === 1 ? "This document is" : "These documents are"} attached when the
            entry is saved. Nothing is written until then.
          </p>
        {/if}
      {:else if attachments === null}
        <p class="text-sm text-text-muted">Reading what is attached.</p>
      {:else if attachments.length === 0}
        <div
          class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border-default p-16 text-center"
        >
          <p class="text-sm text-text-muted">Nothing is attached to this entry.</p>
          <p class="text-xs text-text-subtle">
            Pick one of the matter's documents above. The file stays where it is.
          </p>
        </div>
      {:else}
        <ul class="mc-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {#each attachments as attachment (attachment.fileId)}
            <li class="flex items-center gap-8 rounded-md border border-border-default p-8">
              <Paperclip class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-sm">
                <!-- A file whose row is gone still had a link; the link says so rather than
                     rendering a blank the reader cannot act on. -->
                {attachment.fileName ?? "This document is no longer on the matter"}
              </span>
              <span class="text-xs whitespace-nowrap text-text-subtle">
                {formatInstantDate(attachment.createdAt)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                title="Detach this file. It stays in the matter's documents."
                aria-label="Detach {attachment.fileName ?? 'this file'}"
                onclick={() => void detachFile(attachment.fileId)}
              >
                <X class="size-16" aria-hidden="true" />
              </Button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
{/snippet}

<!--
  HISTORY IS ALSO WHERE TWO FACTS LIVE. The entered date and who entered it are not repeated in the
  record pane: the rail's first event states both, in the place a reader goes for when-and-by-whom.
-->
{#snippet historyTab()}
  <EventRail
    events={events === null ? [] : historyEvents(events)}
    loading={entry !== null && events === null}
    label="This entry's history"
    emptyMessage={entry === null
      ? "A new entry has no history yet. Saving it records the first event."
      : "Nothing has been recorded against this entry."}
  />
{/snippet}

{#snippet billingTab()}
  <div class="flex flex-col gap-16">
    {#if entry !== null}
      <div>
        <Badge {...statusBadgeAttributes(entry.status)}>{statusEntry(entry.status).label}</Badge>
      </div>
      {#if entry.status !== "void"}
        <RecordChain current={entry.status === "billed" ? "billed" : "draft"} />
      {/if}
      <div class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="size-16 shrink-0" aria-hidden="true" />
        <span>
          {#if entry.status === "billed"}
            Billed. Which invoice took it up is not served yet: waiting on {gapReason("invoice")}.
          {:else}
            Not on a bill yet. Add it to a draft bill from the Billing tab.
          {/if}
        </span>
      </div>
      <dl class="flex flex-col gap-4 text-sm">
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Billing</dt>
          <dd>{entry.billable ? "Billable, next bill" : "Non-billable"}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Work Date</dt>
          <dd class="tabular-nums">{formatDate(entry.workDate)}</dd>
        </div>
      </dl>
    {:else}
      <div class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="size-16 shrink-0" aria-hidden="true" />
        <span>Not on a bill yet. Add it to a draft bill from the Billing tab.</span>
      </div>
    {/if}
  </div>
{/snippet}

<!--
  This file's verbs only. While the fields are open the window appends the abandon and the commit
  after these, so Cancel and Save are the same two controls, in the same place, saying the same
  thing, on every kind of record in the product.
-->
{#snippet actions({ editing: fieldsOpen }: { editing: boolean })}
  {#if !fieldsOpen && lockLine !== null}
    <span class="mr-auto flex items-center gap-4 text-xs text-text-muted">
      <Lock class="size-12" aria-hidden="true" />
      {lockLine}
    </span>
  {:else if fieldsOpen}
    <span class="mr-auto flex items-center gap-4 text-xs text-text-muted">
      <SquarePen class="size-12" aria-hidden="true" />
      Saves as a draft.
    </span>
  {/if}
  {#if !fieldsOpen}
    <!--
      The two verbs the chain is designed to carry and no route serves. They are rendered where the
      design puts them rather than left out, so a reader can see that withdrawing a submission and
      removing a never-reviewed draft are real acts of this record, and can never mistake either for
      working. Each appears only against the status it belongs to: a verb offered where it could
      never apply says nothing true even when it is refused.
    -->
    {#if entry?.status === "void"}
      <!--
        THE ONE VERB A VOIDED ENTRY HAS. It is offered here rather than in the ledger's menu alone
        because this window is where somebody lands when they open the entry to find out what
        happened to it, and finding out is usually the moment they realise the void was a mistake.
        The refusals are the server's — an entry whose value became a cost stays void — and the
        window says which one it hit rather than a generic failure.
      -->
      <Button
        variant="secondary"
        disabled={unvoiding}
        title="Return this entry to draft. It keeps its number, note, codes, documents and history."
        onclick={() => void restore()}
      >
        Unvoid
      </Button>
    {:else if entry?.status === "submitted"}
      <SoonAffordance reason={gapReason("unsubmit")}>
        {#snippet control(soon)}
          <Button variant="secondary" {...soon}>Unsubmit</Button>
        {/snippet}
      </SoonAffordance>
    {:else if entry?.status === "draft"}
      <SoonAffordance reason={gapReason("deleteDraft")}>
        {#snippet control(soon)}
          <Button variant="secondary" {...soon}>Delete Draft</Button>
        {/snippet}
      </SoonAffordance>
    {/if}
    <Button onclick={() => (open = false)}>Close</Button>
  {:else if creating || onContinueNew !== undefined}
    <!-- The one verb this record type adds: entering time is a run of entries, and a person who
         has just logged one is usually about to log the next. It carries the context forward —
         the matter, the staff, the date — and clears what belonged to the entry just saved. -->
    <Button
      variant="secondary"
      disabled={saveRefusal !== undefined}
      title={saveRefusal ?? "Save this entry and start another carrying the matter and the date"}
      onclick={() => void save(true)}
    >
      Save &amp; New
    </Button>
  {/if}
{/snippet}

<!-- The window's own menu: the rare acts and the reader's settings, off the fields' way. -->
{#snippet entryMenu()}
  <DropdownMenu.GroupHeading>Settings</DropdownMenu.GroupHeading>
  <DropdownMenu.CheckboxItem
    checked={timePreferences.defaultStaffToSelf}
    onCheckedChange={(next) => timePreferences.setDefaultStaffToSelf(next)}
  >
    Default staff member to self
  </DropdownMenu.CheckboxItem>
  <DropdownMenu.Separator />
  <!--
    HOW MANY WAYS OF SAYING A DURATION THIS READER WANTS TO SEE. All three are live whichever are
    shown; this is about the screen, not the capability. The last one standing is disabled rather
    than hidden — a window with no way to state how long the work took cannot record time, so the
    control says "this one has to stay" by refusing rather than by vanishing.
  -->
  <DropdownMenu.GroupHeading>Enter time as</DropdownMenu.GroupHeading>
  {#each TIME_ENTRY_MODES as mode (mode)}
    {@const shown = timePreferences.showsEntryMode(mode)}
    {@const last = shown && timePreferences.entryModes.length === 1}
    <DropdownMenu.CheckboxItem
      checked={shown}
      disabled={last}
      title={last ? "One way of entering time has to stay on screen." : undefined}
      onCheckedChange={(next) => timePreferences.setEntryMode(mode, next)}
    >
      {TIME_ENTRY_MODE_LABELS[mode]}
    </DropdownMenu.CheckboxItem>
  {/each}
{/snippet}

<RecordWindow
  bind:open
  bind:editing
  {heading}
  {subtitle}
  {record}
  {actions}
  menu={entryMenu}
  tabs={[
    { key: "attachments", label: "Attachments", content: attachmentsTab },
    { key: "history", label: "History", content: historyTab },
    { key: "billing", label: "Billing", content: billingTab },
  ] satisfies RecordWindowTab[]}
  defaultTab="history"
  editDisabledReason={editRefusal}
  saveDisabledReason={saveRefusal}
  saveLabel={"Save & Close"}
  {unsavedChanges}
  onSave={() => void save(false)}
  onCancel={forgetChanges}
  onPrint={() => (printOpen = true)}
  style="block-size: min(92vh, calc(var(--mc-size-record-window) * 0.625))"
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
