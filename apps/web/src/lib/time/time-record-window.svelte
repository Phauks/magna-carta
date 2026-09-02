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
  import { formatDuration, formatInstant } from "@magna-carta/design-system/formatters";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Info from "@lucide/svelte/icons/info";
  import Lock from "@lucide/svelte/icons/lock";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
  import MatterPicker from "./matter-picker.svelte";
  import { timekeeperOf } from "./time-columns.ts";
  import { gapReason, TIME_LEDGER_GAPS } from "./time-gaps.ts";
  import { timePreferences } from "./time-preferences.svelte.ts";
  import { matterDisplay, provisionalTimeCode, type SheetMatter } from "./time-sheet-model.ts";
  import {
    createTimeEntry,
    draftRefusal,
    parseDurationText,
    patchTimeEntry,
    writeKey,
    type TimeEntryDraftFields,
  } from "./time-operations.ts";
  import { timeEntrySheet } from "./time-print-sheet.ts";
  import { listMatterTasks, type MatterTask } from "$lib/matters/tasks-api.ts";

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
   * The firm's rounding increment is a firm setting, not a per-entry choice, and it is not served.
   * Until it is, the window shows the time worked as the time billed and says nothing about
   * rounding — a rounding sentence written against a number nobody configured would be fiction.
   */
  const roundingUnserved =
    "The firm's rounding increment is not served, so this window shows the worked time as billed.";

  let descriptionText = $state("");
  let workDateText = $state("");
  let durationText = $state("");
  let timekeeperUserId = $state("");
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
    workDate: "",
    duration: "",
    timekeeperUserId: "",
    matterId: null as string | null,
    taskId: null as string | null,
    billing: "billable",
  });

  function rememberWhatIsInTheFields(): void {
    seeded.description = descriptionText;
    seeded.workDate = workDateText;
    seeded.duration = durationText;
    seeded.timekeeperUserId = timekeeperUserId;
    seeded.matterId = chosenMatterId;
    seeded.taskId = chosenTaskId;
    seeded.billing = billableChoice;
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
    workDateText = start?.workDate ?? new Date().toISOString().slice(0, 10);
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
    rememberWhatIsInTheFields();
  });

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
    void listMatterTasks(fetch, forMatter, undefined, { states: ["open"] }).then((outcome) => {
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
      workDateText !== seeded.workDate ||
      durationText !== seeded.duration ||
      timekeeperUserId !== seeded.timekeeperUserId ||
      chosenMatterId !== seeded.matterId ||
      chosenTaskId !== seeded.taskId ||
      billableChoice !== seeded.billing,
  );

  /*
   * Abandoning. The window has already left its editing mode by the time this runs, so the work
   * here is putting the fields back where they were — and, for an entry that was being written from
   * nothing, closing: a new entry has no earlier state to fall back to, so leaving its fields and
   * leaving the window are the same act.
   */
  function forgetChanges(): void {
    descriptionText = seeded.description;
    workDateText = seeded.workDate;
    durationText = seeded.duration;
    timekeeperUserId = seeded.timekeeperUserId;
    chosenMatterId = seeded.matterId;
    billableChoice = seeded.billing;
    saveFailure = null;
    if (entry === null) open = false;
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
   * The four billing dispositions the record is designed to carry. The two the model actually holds
   * are live; the two that need a disposition beyond a boolean stay visible, refused, saying what
   * they wait on — a choice that exists and is not offered is a choice a reader cannot know about.
   */
  const BILLING_CHOICES = [
    { value: "billable", label: "Billable, next invoice", waitsOn: null },
    { value: "nonbillable", label: "Non-billable", waitsOn: null },
    { value: "hold", label: "Billable, hold", waitsOn: gapReason("billingDisposition") },
    {
      value: "nocharge",
      label: "No charge, on the bill at nothing",
      waitsOn: gapReason("billingDisposition"),
    },
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

  const workedMinutes = $derived(parseDurationText(durationText));
  const billedMinutes = $derived(workedMinutes);
  const billable = $derived(billableChoice === "billable");

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
    if (entry === null) return "A new entry is written in its fields; there is nothing to read yet.";
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
          date: (isoDate) => formatDate(isoDate),
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
              taskId: chosenTaskId,
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
              taskId: chosenTaskId,
            },
            writeKey(),
          );
    saving = false;
    if (outcome.kind !== "ok") {
      saveFailure =
        outcome.kind === "problem"
          ? `The entry was not saved. The server answered ${String(outcome.problem.status)}.`
          : "Nothing answered. The entry was not saved and the record is unchanged.";
      return;
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
      durationText = "";
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
    <span title={TIME_LEDGER_GAPS.entryNumber.field + " is not recorded yet."}>
      Entry number not yet recorded
    </span>
    <Badge {...statusBadgeAttributes(entry.status)}>{statusEntry(entry.status).label}</Badge>
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
      {#if creating}
        <div class="flex flex-col gap-4">
          <Label for="time-record-matter">Matter</Label>
          <MatterPicker
            inputId="time-record-matter"
            {matters}
            value={chosenMatterId}
            capped={mattersCapped}
            disabled={readOnly}
            title="Where this time belongs. Type the number or the name; either finds it."
            onpick={(picked) => (chosenMatterId = picked)}
          />
        </div>
      {:else}
        {@render unservedField("Matter", "matter", "Matter")}
      {/if}

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
              title="Whose work this is. The record keeps the name it was captured with."
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

      {@render unservedField("Category", "category", "Category")}
      {@render unservedField("Activity Code", "activity", "Activity Code")}
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
              title="Which piece of work on this matter this time went to. Optional — most entries name none."
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

    <!-- Worked, rounded to billed, times rate, equals amount: one relationship on one line. -->
    <div class="flex flex-wrap items-end gap-8">
      <div class="flex min-w-0 flex-1 flex-col gap-4">
        <Label for="time-record-worked">Time Worked</Label>
        <Input
          id="time-record-worked"
          placeholder="Time Worked"
          title="Time worked, typed either way: 1:30 or 1.5"
          disabled={readOnly}
          bind:value={durationText}
        />
      </div>
      <span class="pb-8 text-text-subtle" aria-hidden="true">&rarr;</span>
      <div class="flex flex-col gap-4">
        <span class="text-xs text-text-subtle">Billed</span>
        <span class="pb-8 tabular-nums" title={roundingUnserved}>
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
        <Label>Rate</Label>
        <!-- The Soon mark rides BESIDE the control, so the control has to be allowed to give up
             width for it. Left at its own full width it pushed the mark past the pane's edge, which
             the pane does not scroll sideways: the badge was simply cut off. -->
        <SoonAffordance class="min-w-0" reason={gapReason("rate")}>
          {#snippet control(soon)}
            <Input class="min-w-0 flex-1" placeholder="Rate" {...soon} />
          {/snippet}
        </SoonAffordance>
      </div>
      <span class="pb-8 text-text-subtle" aria-hidden="true">=</span>
      <div class="flex flex-col gap-4">
        <span class="text-xs text-text-subtle">Amount</span>
        <span class="pb-8 tabular-nums">{amountLine}</span>
      </div>
    </div>
    <p class="text-xs text-text-subtle">{roundingUnserved}</p>

    <div class="flex flex-col gap-4">
      <Label>Internal Memo</Label>
      <SoonAffordance class="min-w-0" reason={gapReason("memo")} reasonPlacement="line">
        {#snippet control(soon)}
          <Textarea class="min-w-0 flex-1" rows={2} placeholder="Internal Memo" {...soon} />
        {/snippet}
      </SoonAffordance>
    </div>
  </div>
{/snippet}

<!-- THE WHOLE TAB IS THE DROPZONE. Attaching a file is the tab's one act, so the entire pane
     takes a drop, the two deliberate doors sit at its top right, and the list of what is already
     attached fills the rest. -->
{#snippet attachmentsTab()}
  <div class="flex h-full min-h-0 flex-col gap-8">
    <div class="flex items-center justify-end gap-8">
      <SoonAffordance reason={gapReason("attachments")}>
        {#snippet control(soon)}
          <Button variant="secondary" size="sm" {...soon}>From the Matter</Button>
        {/snippet}
      </SoonAffordance>
      <SoonAffordance reason={gapReason("attachments")}>
        {#snippet control(soon)}
          <Button variant="secondary" size="sm" {...soon}>Upload</Button>
        {/snippet}
      </SoonAffordance>
    </div>
    <div
      class="flex min-h-0 flex-1 flex-col rounded-md border border-dashed border-border-default"
      role="presentation"
    >
      <div class="flex flex-1 flex-col items-center justify-center gap-4 p-16 text-center">
        <p class="text-sm text-text-muted">Drop files anywhere on this pane to attach them.</p>
        <p class="text-xs text-text-subtle">
          Waiting on {gapReason("attachments")}.
        </p>
      </div>
    </div>
  </div>
{/snippet}

{#snippet historyTab()}
  <EventRail
    events={[]}
    label="This entry's history"
    emptyMessage="Not built yet. Waiting on {gapReason('history')}. The entered date and who entered
      it are the first event this rail will carry."
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
            Not on a bill yet. A draft invoice claims it from the Billing tab.
          {/if}
        </span>
      </div>
      <dl class="flex flex-col gap-4 text-sm">
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Billing</dt>
          <dd>{entry.billable ? "Billable, next invoice" : "Non-billable"}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Work Date</dt>
          <dd class="tabular-nums">{formatDate(entry.workDate)}</dd>
        </div>
      </dl>
    {:else}
      <div class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="size-16 shrink-0" aria-hidden="true" />
        <span>Not on a bill yet. A draft invoice claims it from the Billing tab.</span>
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
    {#if entry?.status === "submitted"}
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
