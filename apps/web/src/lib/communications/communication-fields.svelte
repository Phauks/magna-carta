<script lang="ts">
  /*
   * What a call or a text IS, as fields — the one layout, shared by every window that records one
   * and corrects one. There is only one such window now (communication-record-window.svelte), which
   * is what this component was always for.
   *
   * THE DESCRIPTION IS A LINE BENEATH THE OTHER INFORMATION (owner ruling, 2026-09-08), not a column
   * beside it. It was put in a second column a round earlier, on the reasoning that the measurable
   * facts and the written account are different kinds of answer given at different moments. They
   * are — and it still read wrong, because the description is PROSE and prose wants the width of the
   * thing it is in, while every fact above it is a few characters in a labelled box. The same shape
   * the time sheet reaches for: the facts on the row, the description underneath it with the whole
   * width to wrap in.
   *
   * A CALL AND A TEXT LOOK THE SAME (owner ruling, 2026-09-08), and switching between them MOVES
   * NOTHING. Every field a call has, a text has: a text simply has no end and no length, so those
   * two stand refused rather than vanishing. A control that disappears reflows the form under the
   * hand of the person filling it in, which is worse than a control that is plainly unavailable.
   *
   * THE LENGTH IS TYPED, AND IT NEED NOT BE THE SPAN (owner ruling, 2026-09-08: "you should be able
   * to type in the length of time for the call, and this doesn't need to match calculation,
   * considering people can be put on hold"). Start and End say how long the line was open; Duration
   * says how long the call took. Typing an End fills an EMPTY Duration, because that is the ordinary
   * case and nobody should type one answer twice — and it never overwrites one somebody typed, which
   * is the whole of the ruling. Where the two disagree the form says so in a line under them, so the
   * difference reads as a fact about the call rather than as a mistake nobody noticed.
   *
   * EVERY CHOICE IS TYPED INTO. Type, direction, the country, where it belongs: each is a combobox
   * over a closed set ($lib/components/choice-picker.svelte), never a select. A reader should not
   * have to find out which lists accept typing.
   *
   * THE NUMBER, ITS COUNTRY AND ITS EXTENSION ARE ONE FIELD, and it is the Directory's
   * ($lib/directory/phone-number-field.svelte) — the same field the firm's contact records are
   * entered in. One place in the product knows how a country writes its numbers, and one place knows
   * what to do with the digits a direct dial adds past the end of them.
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
  import CallerLookup from "./caller-lookup.svelte";
  import { DISPOSITION_CHOICES, durationText } from "./communication-vocabulary.ts";
  import type {
    CommunicationDirection,
    CommunicationDisposition,
  } from "./communications-api.ts";
  import {
    draftSpanMinutes,
    isTextDraft,
    parseDurationMinutes,
    type LogDraft,
    type LogKind,
  } from "./log-draft.ts";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";

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
     * False when a record already on the log is being corrected: there, where it belongs is not a
     * field at all. It is a decision about the firm's work, each of its moves is its own
     * concurrency-safe act, and those live in the window's action bar. It is TRUE when a record is
     * being made, because at that moment the anchor is simply one of the things being said.
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

  /** Why the end and the length of a text are refused rather than asked for. */
  const NO_LENGTH_ON_A_TEXT = "A text happens at one moment. It has no end and no length.";

  const spanMinutes = $derived(draftSpanMinutes(draft));
  const takenMinutes = $derived(parseDurationMinutes(draft.durationText));

  /**
   * What the line under the two says, or null when there is nothing worth saying.
   *
   * It appears only where the length and the span DIFFER, because that is the only case a reader
   * might otherwise take for a mistake — and it states both, in the words that explain the gap,
   * rather than warning about it. A call is put on hold; that is not an error.
   */
  const spanNote = $derived.by((): string | null => {
    if (text || spanMinutes === null || takenMinutes === null) return null;
    if (spanMinutes === takenMinutes) return null;
    const span = durationText(spanMinutes * 60) ?? "";
    const taken = durationText(takenMinutes * 60) ?? "";
    return spanMinutes > takenMinutes
      ? `The line was open ${span}; ${taken} of it was the call. The rest reads as hold.`
      : `The length is longer than the ${span} between the start and the end.`;
  });

  /**
   * An end typed fills the length, ONCE, while the length is empty.
   *
   * The convenience without the derivation: somebody who has just put the phone down knows both
   * times and should not have to work the subtraction out, and somebody who has typed a length knows
   * something the subtraction does not.
   */
  function endTyped(value: string): void {
    draft.endTime = value;
    if (draft.durationText.trim() !== "") return;
    const span = draftSpanMinutes(draft);
    if (span !== null) draft.durationText = String(span);
  }

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
    // The contact's own extension comes with it. It is part of how they are reached, and a person
    // who has to retype it beside a number the platform just filled in will not.
    if (chosen.extension !== null) draft.counterpartyExtension = chosen.extension;
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
     ancestor's width and never the element's own, so a `@container` on the row would silently never
     match. The query is on the fields' own box rather than the viewport, which is what lets a narrow
     pane stack the paired fields without a second layout. -->
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
    bind:extension={draft.counterpartyExtension}
    countryInputId="{identity}-country"
    numberInputId="{identity}-number"
    extensionInputId="{identity}-extension"
    disabled={busy}
  />

  <!-- Who the number belongs to: a Directory contact, the area code's region, and the network's
       caller ID once somebody has paid to ask. Help with the form rather than part of it, so it is
       silent until the number is a whole one and silent again if the read fails. -->
  <CallerLookup
    region={draft.region}
    number={draft.counterpartyNumber}
    hasContact={draft.counterpartyEntityId !== null}
    disabled={busy}
    onUseContact={(match) =>
      chooseContact({
        identifier: match.entityId,
        name: match.displayName ?? "This contact",
        kind: match.entityKind,
      })}
  />

  <div class="flex flex-col gap-4">
    <div class="grid gap-12 @sm:grid-cols-2 @lg:grid-cols-4">
      <!-- The wall clock, read in the reader's own zone in both directions: the person typing it is
           saying what their own clock said. The day is its own field, because changing the day of a
           call recorded this morning must not mean stepping through a combined control. -->
      <!-- The picker renders its own label, so it takes a track of its own rather than a
           LabelledField: its label and its field are siblings and a grid would split them. -->
      <div class="flex flex-col gap-8">
        <DatePicker
          label="Date"
          value={civilDateValue(draft.occurredDate)}
          onValueChange={(next) => (draft.occurredDate = civilDateTextOrEmpty(next))}
          disabled={busy}
        />
      </div>

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
            title={text ? NO_LENGTH_ON_A_TEXT : "When the line closed."}
            value={draft.endTime}
            oninput={(event) => {
              endTyped(event.currentTarget.value);
            }}
          />
        {/snippet}
      </LabelledField>

      <LabelledField label="Duration" id="{identity}-duration">
        {#snippet children({ props })}
          <!-- Typed, and free: "20", "1h 5m" and "1:20" all read as the same length. It is filled
               from the end when it is empty and never against what somebody wrote. -->
          <Input
            {...props}
            class="tabular-nums"
            disabled={busy || text}
            title={text ? NO_LENGTH_ON_A_TEXT : "How long the call took. 20, 1h 5m or 1:20."}
            placeholder={placeholderOf("Duration")}
            bind:value={draft.durationText}
          />
        {/snippet}
      </LabelledField>
    </div>

    {#if spanNote !== null}
      <p class="text-xs text-text-muted">{spanNote}</p>
    {/if}
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

  <!-- What was said, beneath everything else and across the whole of it. One word for both types: on
       a text it is the message, on a call it is what the member wrote down. The record keeps the two
       in different columns so a read never has to ask which it is holding, and the person typing does
       not have to care. -->
  <div class="flex flex-col gap-8">
    <Label for="{identity}-description">Description</Label>
    <Textarea
      id="{identity}-description"
      class="resize-none"
      rows={6}
      resizable={false}
      disabled={busy}
      placeholder={placeholderOf("Description")}
      bind:value={draft.description}
    />
  </div>
</div>
