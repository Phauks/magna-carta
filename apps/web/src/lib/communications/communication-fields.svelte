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
   * THE NUMBER LEADS (owner, 2026-11-09: "most of the information people get is the phone number,
   * and maybe a caller ID"). Type and direction are two pressed buttons above it rather than lists
   * ($lib/components/button-choice.svelte; owner, same day: "make the call text, incoming/outgoing as a
   * toggle, makes it easier"), then the number, then what was said — which is where somebody still on
   * the telephone is typing — and only then when it happened, which is folded to one line because it
   * is almost always now. Every LIST that can grow (the country, where it belongs) is still a
   * combobox over a closed set, typed into.
   *
   * THE NUMBER, ITS COUNTRY AND ITS EXTENSION ARE ONE FIELD, and it is the Directory's
   * ($lib/directory/phone-number-field.svelte) — the same field the firm's contact records are
   * entered in. One place in the product knows how a country writes its numbers, and one place knows
   * what to do with the digits a direct dial adds past the end of them.
   *
   * WHO CALLED, AND WHAT HAPPENED, come straight after the number while a record is being made
   * (owner, 2026-11-09): the name the caller gave, typed as Caller ID, and the Activity section
   * (./communication-activity.svelte) that records an answer, a transfer, a message or spam.
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
  import Button from "@magna-carta/design-system/button";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import ButtonChoice, { type ButtonChoiceOption } from "$lib/components/button-choice.svelte";
  import CommunicationActivity from "./communication-activity.svelte";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import PhoneNumberField from "$lib/directory/phone-number-field.svelte";
  import { chooseContact, clearContact, contactSelectionOf } from "./communication-contact.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import { DISPOSITION_CHOICES, durationText } from "./communication-vocabulary.ts";
  import type {
    CommunicationDirection,
    CommunicationDisposition,
  } from "./communications-api.ts";
  import {
    draftOccurredAt,
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
    showContact = true,
    showActivity = false,
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
    /**
     * Whether the form carries its own contact field.
     *
     * False while a record is being MADE: there the window's Identification panel looks the number
     * up and owns who it was with, beside the form rather than inside it, so the form asks nothing
     * the panel has already answered.
     */
    showContact?: boolean;
    /**
     * Whether the form asks for the caller's name and what happened on the line.
     *
     * True only while a record is being MADE: the transfer and the message a call leaves are acts
     * done once, as it is saved, and a correction cannot take them back.
     */
    showActivity?: boolean;
  } = $props();

  const identity = $props.id();
  const text = $derived(isTextDraft(draft));

  const TYPE_OPTIONS: readonly ButtonChoiceOption<LogKind>[] = [
    { value: "call", label: "Call" },
    { value: "text", label: "Text" },
  ];

  const DIRECTION_OPTIONS: readonly ButtonChoiceOption<CommunicationDirection>[] = [
    { value: "inbound", label: "Incoming", title: "The other person contacted the firm." },
    { value: "outbound", label: "Outgoing", title: "The firm contacted them." },
  ];

  /*
   * WHEN IT HAPPENED, FOLDED. A new record starts at the moment it was opened, which is right for
   * nearly every call somebody is still on — so the three fields sit behind one line that says what
   * they hold, and open on a press for the call being written up after the fact.
   */
  let whenOpen = $state(false);
  const whenSummary = $derived.by((): string => {
    const at = draftOccurredAt(draft);
    if (at === "") return "Not set";
    const started = formatInstant(at);
    return draft.endTime.trim() === "" || text ? started : `${started} to ${draft.endTime}`;
  });

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
      ? `The line was open ${span}; ${taken} of it was the call. The rest was hold.`
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

  const contactSelection = $derived(contactSelectionOf(draft));

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
  <div class="flex flex-wrap gap-12">
    <ButtonChoice
      label="Type"
      options={TYPE_OPTIONS}
      value={draft.kind}
      disabled={busy}
      onchange={(chosen) => (draft.kind = chosen)}
    />
    <ButtonChoice
      label="Direction"
      options={DIRECTION_OPTIONS}
      value={draft.direction}
      disabled={busy}
      onchange={(chosen) => (draft.direction = chosen)}
    />
  </div>

  <PhoneNumberField
    bind:region={draft.region}
    bind:number={draft.counterpartyNumber}
    bind:extension={draft.counterpartyExtension}
    countryInputId="{identity}-country"
    numberInputId="{identity}-number"
    extensionInputId="{identity}-extension"
    disabled={busy}
  />

  {#if showActivity}
    <!-- The name the caller gave, as somebody heard it. Optional, and never a Directory record:
         choosing who the number belongs to is the Identification panel's, beside the form. -->
    <LabelledField label="Caller ID (optional)" id="{identity}-caller-id">
      {#snippet children({ props })}
        <Input
          {...props}
          disabled={busy}
          maxlength={200}
          placeholder={placeholderOf("Caller ID")}
          bind:value={draft.callerIdName}
        />
      {/snippet}
    </LabelledField>

    <CommunicationActivity bind:draft {busy} />
  {/if}

  {#if showContact}
    <LabelledField label="Contact" id="{identity}-contact">
      {#snippet children({ props })}
        <!-- The Directory record at the other end. Optional: a number nobody has recorded is
             exactly the case the queue exists for, and demanding a contact first would put a lookup
             in front of the one act this form exists to make quick. -->
        <DirectoryEntityPicker
          inputId={props.id}
          label="Contact"
          disabled={busy}
          createBeside={false}
          value={contactSelection}
          onSelect={(entity) => chooseContact(draft, entity)}
          onClear={() => clearContact(draft)}
        />
      {/snippet}
    </LabelledField>
  {/if}

  <!-- What was said, straight under the number and across the whole width (owner, 2026-11-09): it
       is what somebody still on the telephone is typing, so it sits where they are already looking
       rather than at the bottom of the form. On a text it is the message, on a call it is what the
       member wrote down; the record keeps the two in different columns, and the label says which. -->
  <div class="flex flex-col gap-8">
    <Label for="{identity}-description">{text ? "What the text said" : "Notes"}</Label>
    <Textarea
      id="{identity}-description"
      class="resize-none"
      rows={5}
      resizable={false}
      disabled={busy}
      placeholder={placeholderOf(text ? "Message" : "Notes")}
      bind:value={draft.description}
    />
  </div>

  <div class="flex flex-col gap-4">
    {#if whenOpen}
      <div class="grid gap-12 @sm:grid-cols-2 @lg:grid-cols-4">
        <!-- The wall clock, read in the reader's own zone in both directions: the person typing it
             is saying what their own clock said. The picker renders its own label, so it takes a
             track of its own rather than a LabelledField: its label and its field are siblings and a
             grid would split them. -->
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

        <LabelledField label="Length" id="{identity}-duration">
          {#snippet children({ props })}
            <!-- Typed, and free: "20", "1h 5m" and "1:20" all read as the same length. It is filled
                 from the end when it is empty and never against what somebody wrote. -->
            <Input
              {...props}
              class="tabular-nums"
              disabled={busy || text}
              title={text ? NO_LENGTH_ON_A_TEXT : "How long the call took. 20, 1h 5m or 1:20."}
              placeholder={placeholderOf("Length")}
              bind:value={draft.durationText}
            />
          {/snippet}
        </LabelledField>
      </div>
    {:else}
      <div class="grid items-end gap-12 @sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <span class="text-sm font-medium" id="{identity}-when">When</span>
          <div
            class="flex min-h-40 items-center justify-between gap-12 rounded-md border border-border-default bg-surface-sunken px-12"
            aria-labelledby="{identity}-when"
            role="group"
          >
            <span class="tabular-nums">{whenSummary}</span>
            <Button size="sm" variant="ghost" disabled={busy} onclick={() => (whenOpen = true)}>
              Change
            </Button>
          </div>
        </div>
        <LabelledField label="Length" id="{identity}-duration">
          {#snippet children({ props })}
            <Input
              {...props}
              class="tabular-nums"
              disabled={busy || text}
              title={text ? NO_LENGTH_ON_A_TEXT : "How long the call took. 20, 1h 5m or 1:20."}
              placeholder={placeholderOf("Length")}
              bind:value={draft.durationText}
            />
          {/snippet}
        </LabelledField>
      </div>
    {/if}

    {#if spanNote !== null}
      <p class="text-xs text-text-muted">{spanNote}</p>
    {/if}
  </div>

  {#if showAnchor && !matterFixed && !(showActivity && draft.outcome === "spam")}
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
