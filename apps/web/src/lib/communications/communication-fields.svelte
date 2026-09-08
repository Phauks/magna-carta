<script lang="ts">
  /*
   * What a call or a text IS, as fields — the one layout, shared by the window that records one and
   * the window that corrects one.
   *
   * TWO COLUMNS: THE MEASURABLE AND THE WRITTEN (owner ruling, 2026-09-08). The left side is
   * everything about the call that is a quantity or a fact somebody could look up — type, direction,
   * who, which number, when it started, when it ended, how long it ran, where it belongs. The right
   * side is what was actually said. They are different kinds of answer and they are answered at
   * different moments: the left is filled in from the phone's own record of the call in a few
   * seconds, and the right is written. Putting the description beside the facts rather than under
   * them also leaves the right side room to become tabs — the text, a transcript, the recording —
   * which is where this screen is going once the carrier is connected.
   *
   * A CALL AND A TEXT LOOK THE SAME (owner ruling, 2026-09-08), and switching between them MOVES
   * NOTHING. Every field a call has, a text has: the length of a text is simply not a fact, so its
   * end and its duration stand refused rather than vanishing. A control that disappears reflows the
   * form under the hand of the person filling it in, which is worse than a control that is plainly
   * unavailable.
   *
   * A DURATION IS NOT TYPED, IT IS WORKED OUT. The form asks when the call started and when it
   * ended, because that is what somebody who has just put the phone down knows; the length follows
   * from the two (log-draft.ts). The three sit together, because they are one answer in three parts.
   *
   * EVERY CHOICE IS TYPED INTO. Type, direction, the country, where it belongs: each is a combobox
   * over a closed set ($lib/components/choice-picker.svelte), never a select. A reader should not
   * have to find out which lists accept typing.
   *
   * THE NUMBER AND ITS COUNTRY ARE ONE FIELD, and it is the Directory's
   * ($lib/directory/phone-number-field.svelte) — the same field the firm's contact records are
   * entered in. One place in the product knows how a country writes its numbers.
   *
   * WHERE IT BELONGS IS ONE FIELD WITH EVERY ANSWER IN IT. A matter, searched by number or name; or
   * a reason it is on no matter — spam, the firm's own business, a prospect nothing came of; or
   * nothing yet, which leaves it in the queue. All of them in the common matter picker, because
   * asking the category first and the matter second made a receptionist answer one question twice.
   */
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import type { CountryCode } from "libphonenumber-js/min";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import PhoneNumberField from "$lib/directory/phone-number-field.svelte";
  import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
  import { formatPhoneAsTyped } from "$lib/directory/phone-entry.ts";
  import {
    entityKindFromIdentifier,
    readDirectoryContactPoints,
  } from "$lib/directory/directory-api.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import { DISPOSITION_CHOICES, durationText } from "./communication-vocabulary.ts";
  import type {
    CommunicationDirection,
    CommunicationDisposition,
  } from "./communications-api.ts";
  import {
    draftEndTime,
    durationFromEnd,
    isTextDraft,
    type LogDraft,
    type LogKind,
  } from "./log-draft.ts";

  let {
    draft = $bindable(),
    busy = false,
    matters,
    mattersCapped = false,
    matterFixed = false,
    matterName = null,
    showAnchor = true,
  }: {
    draft: LogDraft;
    busy?: boolean;
    /** The anchors a row may be filed onto — caseload, consultations AND intakes. */
    matters: readonly SheetMatter[];
    /** Whether that list is a page of the record rather than all of it. */
    mattersCapped?: boolean;
    /**
     * Whether the matter is settled rather than merely suggested.
     *
     * True inside a matter, where the decision is already made — and there the anchor control is
     * not disabled, it is ABSENT. A disabled control implies a choice is being withheld, and an
     * empty one implies the row is on no matter, which is the opposite of what is true. The matter
     * is stated in a line instead.
     */
    matterFixed?: boolean;
    matterName?: string | null;
    /**
     * Whether the form asks where the record belongs.
     *
     * False in the record window, where that is not a field at all: it is a decision about the
     * firm's work, each of its moves is its own concurrency-safe act, and those live in that
     * window's action bar. Asking it here as well would be two ways to do one thing.
     */
    showAnchor?: boolean;
  } = $props();

  const identity = $props.id();
  const text = $derived(isTextDraft(draft));

  const TYPE_OPTIONS: readonly ChoiceOption[] = [
    { value: "call", label: "Call" },
    { value: "text", label: "Text" },
  ];

  const DIRECTION_OPTIONS: readonly ChoiceOption[] = [
    { value: "outbound", label: "Outgoing", keywords: ["out"] },
    { value: "inbound", label: "Incoming", keywords: ["in"] },
  ];

  /** The answers to "where does this belong" that are not matters. */
  const DISPOSITION_OPTIONS = DISPOSITION_CHOICES.map((choice) => ({
    value: choice.value,
    label: choice.label,
    meaning: choice.meaning,
  }));

  /** Why the length of a text is refused rather than asked for. */
  const NO_LENGTH_ON_A_TEXT = "A text has no length.";

  const endTime = $derived(draftEndTime(draft));
  const lengthShown = $derived.by(() => {
    const minutes = Number(draft.durationMinutes.trim());
    if (draft.durationMinutes.trim() === "" || !Number.isFinite(minutes)) return "";
    return durationText(Math.round(minutes) * 60) ?? "";
  });

  /*
   * The selection the contact field shows at rest.
   *
   * The kind comes from the handle's own prefix rather than from a read: a directory handle is minted
   * `directoryPerson_…` or `directoryOrganization_…`, so the glyph beside the name is right without
   * asking the server anything. The NAME does need a read, and the surface that opened this form owns
   * it — until it lands the field says what it holds rather than printing the handle, which is not an
   * answer anybody can use.
   */
  const contactSelection = $derived<PickableEntity | null>(
    draft.counterpartyEntityId === null
      ? null
      : {
          identifier: draft.counterpartyEntityId,
          name: draft.counterpartyName ?? "This contact",
          kind: entityKindFromIdentifier(draft.counterpartyEntityId) ?? "person",
        },
  );

  /**
   * The number the chosen contact answers on, where the field is still empty.
   *
   * It never OVERWRITES a number somebody typed: which number a call actually came from is a fact
   * about the call, and a contact's record is a list of the ways they can be reached rather than a
   * statement about this one. A read that fails leaves the field exactly as it was — the contact is
   * still recorded, and the digits can be typed.
   */
  async function fillNumberFrom(entityId: string): Promise<void> {
    if (draft.counterpartyNumber.trim() !== "") return;
    const outcome = await readDirectoryContactPoints(fetch, entityId);
    if (outcome.kind !== "ok") return;
    const reachable = outcome.value.phones.filter(
      (phone) => phone.contactSystem === "voice" || phone.contactSystem === "sms",
    );
    const chosen = reachable.find((phone) => phone.isPrimary) ?? reachable[0];
    if (chosen === undefined) return;
    // Still empty when the answer lands, or somebody has typed while it was in flight and theirs
    // wins.
    if (draft.counterpartyNumber.trim() !== "") return;
    if (chosen.countryRegionCode !== null) draft.region = chosen.countryRegionCode;
    draft.counterpartyNumber = formatPhoneAsTyped(draft.region as CountryCode, chosen.number);
  }

  function chooseContact(entity: PickableEntity): void {
    draft.counterpartyEntityId = entity.identifier;
    draft.counterpartyName = entity.name;
    void fillNumberFrom(entity.identifier);
  }

  function clearContact(): void {
    draft.counterpartyEntityId = null;
    draft.counterpartyName = null;
  }

  /** A matter chosen, or the row that leaves it in the queue. Either clears a set-aside reason. */
  function anchorToMatter(matterId: string | null): void {
    draft.matterId = matterId;
    draft.disposition = null;
    draft.anchor = matterId === null ? "undecided" : "matter";
  }

  /** A reason chosen. It is never a matter, so the matter goes with it. */
  function anchorToReason(reason: string): void {
    draft.matterId = null;
    draft.disposition = reason as CommunicationDisposition;
    draft.anchor = "setAside";
  }
</script>

<!-- The container is a WRAPPER rather than the grid itself: a container query answers about an
     ancestor's width and never the element's own, so a `@container` on the grid would silently never
     match. The query is on the fields' own box rather than the viewport, which is what lets the
     record window's narrower pane stack the two columns without a second layout. -->
<div class="@container">
  <div class="grid gap-24 @3xl:grid-cols-2">
    <!-- The facts of the call: what it was, who it was with, when, and where it belongs. -->
    <div class="@container flex flex-col gap-16">
      <div class="grid gap-12 @sm:grid-cols-2">
        <LabelledField label="Type" id="{identity}-type">
          {#snippet children({ props })}
            <ChoicePicker
              inputId={props.id}
              label="Type"
              options={TYPE_OPTIONS}
              disabled={busy}
              bind:value={() => draft.kind, (chosen) => (draft.kind = chosen as LogKind)}
            />
          {/snippet}
        </LabelledField>

        <LabelledField label="Direction" id="{identity}-direction">
          {#snippet children({ props })}
            <ChoicePicker
              inputId={props.id}
              label="Direction"
              options={DIRECTION_OPTIONS}
              disabled={busy}
              bind:value={
                () => draft.direction,
                (chosen) => (draft.direction = chosen as CommunicationDirection)
              }
            />
          {/snippet}
        </LabelledField>
      </div>

      <LabelledField label="Contact" id="{identity}-contact">
        {#snippet children({ props })}
          <!-- The Directory record at the other end. Optional: a number nobody has recorded is exactly
               the case the queue exists for, and demanding a contact first would put a lookup in front
               of the one act this form exists to make quick. A record that is not there yet is made
               from inside the list, which is why no New control stands beside the field. -->
          <DirectoryEntityPicker
            inputId={props.id}
            label="Contact"
            disabled={busy}
            createBeside={false}
            value={contactSelection}
            onSelect={chooseContact}
            onClear={clearContact}
          />
        {/snippet}
      </LabelledField>

      <PhoneNumberField
        bind:region={draft.region}
        bind:number={draft.counterpartyNumber}
        countryInputId="{identity}-country"
        numberInputId="{identity}-number"
        disabled={busy}
      />

      <div class="grid gap-12 @sm:grid-cols-2 @lg:grid-cols-4">
        <!-- The wall clock, read in the reader's own zone in both directions: the person typing it is
             saying what their own clock said. The day is its own field, because changing the day of a
             call recorded this morning must not mean stepping through a combined control. -->
        <LabelledField label="Date" id="{identity}-date">
          {#snippet children({ props })}
            <Input {...props} type="date" disabled={busy} bind:value={draft.occurredDate} />
          {/snippet}
        </LabelledField>

        <LabelledField label="Start" id="{identity}-start">
          {#snippet children({ props })}
            <Input {...props} type="time" disabled={busy} bind:value={draft.occurredTime} />
          {/snippet}
        </LabelledField>

        <LabelledField label="End" id="{identity}-end">
          {#snippet children({ props })}
            <Input
              {...props}
              type="time"
              disabled={busy || text}
              title={text ? NO_LENGTH_ON_A_TEXT : undefined}
              value={endTime}
              oninput={(event) => {
                draft.durationMinutes = durationFromEnd(draft, event.currentTarget.value);
              }}
            />
          {/snippet}
        </LabelledField>

        <LabelledField label="Duration" id="{identity}-duration">
          {#snippet children({ props })}
            <!-- Worked out, never typed: it is the distance between the two fields beside it, and a
                 length that disagreed with them would be a third answer to one question. -->
            <Input
              {...props}
              readonly
              class="tabular-nums"
              disabled={busy || text}
              title={text ? NO_LENGTH_ON_A_TEXT : "Worked out from the start and the end."}
              value={lengthShown}
            />
          {/snippet}
        </LabelledField>
      </div>

      {#if showAnchor && !matterFixed}
        <LabelledField label="Belongs to" id="{identity}-anchor">
          {#snippet children({ props })}
            <!-- One field, every answer: a matter — including the unnumbered ones, since an intake and
                 a consultation are where a first contact lands — or a reason there is no matter, or
                 the row left in the queue for somebody to decide later. -->
            <MatterPicker
              {matters}
              capped={mattersCapped}
              disabled={busy}
              inputId={props.id}
              noMatterLabel="Decide later"
              extraChoices={DISPOSITION_OPTIONS}
              extraHeading="Not a matter"
              extraValue={draft.anchor === "setAside" ? draft.disposition : null}
              value={draft.anchor === "matter" ? draft.matterId : null}
              onpick={anchorToMatter}
              onpickExtra={anchorToReason}
            />
          {/snippet}
        </LabelledField>
      {:else if matterFixed && matterName !== null}
        <p class="text-xs text-text-muted">Recorded on {matterName}.</p>
      {/if}
    </div>

    <!-- What was said. One word for both types: on a text it is the message, on a call it is what the
         member wrote down. The record keeps the two in different columns so a read never has to ask
         which it is holding, and the person typing does not have to care. -->
    <div class="flex min-h-0 flex-col gap-8">
      <Label for="{identity}-description">Description</Label>
      <Textarea
        id="{identity}-description"
        class="min-h-0 flex-auto"
        rows={10}
        resizable={false}
        disabled={busy}
        placeholder={placeholderOf("Description")}
        bind:value={draft.description}
      />
    </div>
  </div>
</div>
