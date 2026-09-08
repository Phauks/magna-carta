<script lang="ts">
  /*
   * What a call or a text IS, as fields — the one layout, shared by the window that records one and
   * the window that corrects one.
   *
   * A CALL AND A TEXT LOOK THE SAME (owner ruling, 2026-09-08), and that is what this file exists to
   * guarantee rather than to remember. Type, direction, who it was with, the number, the date, the
   * time, where it belongs, and a description: the same questions in the same places whichever type
   * is chosen. The only field a call has that a text does not is its length in minutes, because a
   * text has no length in seconds and the database refuses one outright.
   *
   * EVERY CLOSED CHOICE PASSES ITS OWN `items`. Bits resolves a select's label from that list, and a
   * select without one renders its raw stored value — `voice`, `outbound` — until the listbox has
   * been opened once. That is what the screen was doing.
   *
   * THE NUMBER CARRIES ITS COUNTRY, which is what makes an area code group correctly and what lets
   * the record store the international form. The knowledge is the Directory's
   * ($lib/directory/phone-entry.ts), reused here rather than re-derived: one place in the product
   * knows how a country writes its numbers.
   *
   * THE CONTACT IS A DIRECTORY RECORD, AND PICKING ONE FILLS THE NUMBER. A firm knows who it is
   * talking to more reliably than it remembers the digits, so the field that names the person comes
   * first and the number follows from it — while staying editable, because the number somebody
   * actually called is a fact about the call and not about the contact's record.
   *
   * WHERE IT BELONGS IS ONE ANSWER WITH THREE SHAPES. A matter; or a reason it is on no matter —
   * spam, the firm's own business, a prospect nothing came of; or nothing yet, which leaves it in
   * the queue. The third is a real answer a receptionist gives all day, and the second is what makes
   * the queue emptiable at all.
   */
  import * as Select from "@magna-carta/design-system/select";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import type { CountryCode } from "libphonenumber-js/min";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
  import {
    formatPhoneAsTyped,
    phoneCountries,
    phoneCountryShortLabel,
  } from "$lib/directory/phone-entry.ts";
  import {
    entityKindFromIdentifier,
    readDirectoryContactPoints,
  } from "$lib/directory/directory-api.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import { DISPOSITION_CHOICES } from "./communication-vocabulary.ts";
  import type { CommunicationDisposition } from "./communications-api.ts";
  import { isTextDraft, type AnchorChoice, type LogDraft } from "./log-draft.ts";
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
     * True inside a matter, where the decision is already made — and there the anchor controls are
     * not disabled, they are ABSENT. A disabled control implies a choice is being withheld, and an
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

  const text = $derived(isTextDraft(draft));

  // Mutable arrays, because that is the shape bits' `items` takes; the lists themselves are fixed.
  const TYPE_ITEMS: { value: string; label: string }[] = [
    { value: "call", label: "Call" },
    { value: "text", label: "Text" },
  ];

  const DIRECTION_ITEMS: { value: string; label: string }[] = [
    { value: "outbound", label: "Outgoing" },
    { value: "inbound", label: "Incoming" },
  ];

  const ANCHOR_ITEMS: { value: string; label: string }[] = [
    { value: "matter", label: "A matter" },
    { value: "setAside", label: "Not a matter" },
    { value: "undecided", label: "Decide later" },
  ];

  const DISPOSITION_ITEMS = DISPOSITION_CHOICES.map((choice) => ({
    value: choice.value,
    label: choice.label,
    meaning: choice.meaning,
  }));

  const countryItems = phoneCountries().map((country) => ({
    value: country.region,
    label: phoneCountryShortLabel(country),
    name: country.name,
  }));

  /*
   * The selection the field shows at rest.
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
</script>

<div class="grid gap-16 sm:grid-cols-2">
  <div class="flex flex-col gap-8">
    <Label id="communication-type-label">Type</Label>
    <Select.Root
      type="single"
      items={TYPE_ITEMS}
      allowDeselect={false}
      disabled={busy}
      bind:value={draft.kind}
    >
      <Select.Trigger aria-labelledby="communication-type-label">
        <Select.Value placeholder={placeholderOf("Type")} />
      </Select.Trigger>
      <Select.Content>
        {#each TYPE_ITEMS as item (item.value)}
          <Select.Item value={item.value} label={item.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <div class="flex flex-col gap-8">
    <Label id="communication-direction-label">Direction</Label>
    <Select.Root
      type="single"
      items={DIRECTION_ITEMS}
      allowDeselect={false}
      disabled={busy}
      bind:value={draft.direction}
    >
      <Select.Trigger aria-labelledby="communication-direction-label">
        <Select.Value placeholder={placeholderOf("Direction")} />
      </Select.Trigger>
      <Select.Content>
        {#each DIRECTION_ITEMS as item (item.value)}
          <Select.Item value={item.value} label={item.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <div class="flex flex-col gap-8 sm:col-span-2">
    <Label for="communication-contact">Contact</Label>
    <!-- The Directory record at the other end. Optional: a number nobody has recorded is exactly the
         case the queue exists for, and demanding a contact first would put a lookup in front of the
         one act this form exists to make quick. -->
    <DirectoryEntityPicker
      inputId="communication-contact"
      label="Contact"
      disabled={busy}
      value={contactSelection}
      onSelect={chooseContact}
      onClear={clearContact}
    />
  </div>

  <div class="flex min-w-0 gap-8">
    <div class="flex shrink-0 flex-col gap-8" style="width: 8.5rem">
      <Label id="communication-country-label">Country</Label>
      <Select.Root
        type="single"
        items={countryItems}
        allowDeselect={false}
        disabled={busy}
        bind:value={draft.region}
      >
        <Select.Trigger aria-labelledby="communication-country-label">
          <Select.Value placeholder={placeholderOf("Country")} />
        </Select.Trigger>
        <Select.Content>
          {#each countryItems as item (item.value)}
            <Select.Item value={item.value} label={item.label}>
              <span class="flex items-baseline gap-8">
                <span class="tabular-nums">{item.label}</span>
                <span class="text-xs text-text-muted">{item.name}</span>
              </span>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="flex min-w-0 flex-auto flex-col gap-8">
      <Label for="communication-number">Number</Label>
      <!-- Grouped as it is typed, in the chosen country's own national form, so an area code lands
           where the eye expects it. The record stores the international form composed from the two. -->
      <Input
        id="communication-number"
        type="tel"
        inputmode="tel"
        autocomplete="off"
        class="tabular-nums"
        disabled={busy}
        placeholder={placeholderOf("Number")}
        value={draft.counterpartyNumber}
        oninput={(event) => {
          const typed = formatPhoneAsTyped(draft.region as CountryCode, event.currentTarget.value);
          event.currentTarget.value = typed;
          draft.counterpartyNumber = typed;
        }}
      />
    </div>
  </div>

  <div class="flex min-w-0 gap-8">
    <div class="flex min-w-0 flex-auto flex-col gap-8">
      <!-- The wall clock, read in the reader's own zone in both directions: the person typing it is
           saying what their own clock said. Two fields rather than one, because changing the day of
           a call recorded this morning must not mean stepping through a combined control. -->
      <DatePicker
        label="Date"
        value={civilDateValue(draft.occurredDate)}
        onValueChange={(next) => (draft.occurredDate = civilDateTextOrEmpty(next))}
        disabled={busy}
      />
    </div>
    <div class="flex shrink-0 flex-col gap-8" style="width: 9rem">
      <Label for="communication-time">Time</Label>
      <Input id="communication-time" type="time" disabled={busy} bind:value={draft.occurredTime} />
    </div>
  </div>

  {#if !text}
    <div class="flex flex-col gap-8">
      <Label for="communication-length">Length in minutes</Label>
      <Input
        id="communication-length"
        inputmode="numeric"
        class="tabular-nums"
        disabled={busy}
        placeholder={placeholderOf("Length in minutes")}
        bind:value={draft.durationMinutes}
      />
    </div>
  {/if}

  {#if showAnchor && !matterFixed}
    <div class="flex flex-col gap-8">
      <Label id="communication-anchor-label">Belongs to</Label>
      <Select.Root
        type="single"
        items={ANCHOR_ITEMS}
        allowDeselect={false}
        disabled={busy}
        bind:value={
          () => draft.anchor,
          (chosen) => {
            draft.anchor = chosen as AnchorChoice;
            // The answer not given is cleared rather than kept out of sight: a matter left behind on
            // a row somebody has just called firm business would be sent, and the server refuses a
            // record carrying both.
            if (draft.anchor !== "matter") draft.matterId = null;
            if (draft.anchor !== "setAside") draft.disposition = null;
          }
        }
      >
        <Select.Trigger aria-labelledby="communication-anchor-label">
          <Select.Value placeholder={placeholderOf("Belongs to")} />
        </Select.Trigger>
        <Select.Content>
          {#each ANCHOR_ITEMS as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    {#if draft.anchor === "matter"}
      <div class="flex flex-col gap-8">
        <Label for="communication-matter">Matter</Label>
        <!-- Every anchor, not only the numbered ones: an intake and a consultation are where a
             first contact lands, so a picker filtered to open matters would refuse the common
             case. -->
        <MatterPicker
          {matters}
          capped={mattersCapped}
          disabled={busy}
          inputId="communication-matter"
          value={draft.matterId}
          onpick={(picked) => (draft.matterId = picked)}
        />
      </div>
    {:else if draft.anchor === "setAside"}
      <div class="flex flex-col gap-8">
        <Label id="communication-disposition-label">Why</Label>
        <Select.Root
          type="single"
          items={DISPOSITION_ITEMS}
          disabled={busy}
          bind:value={
            () => draft.disposition ?? "",
            (chosen) => (draft.disposition = (chosen as CommunicationDisposition) || null)
          }
        >
          <Select.Trigger aria-labelledby="communication-disposition-label">
            <Select.Value placeholder={placeholderOf("Why")} />
          </Select.Trigger>
          <Select.Content>
            {#each DISPOSITION_ITEMS as item (item.value)}
              <Select.Item value={item.value} label={item.label} title={item.meaning} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    {/if}
  {/if}
</div>

{#if matterFixed && matterName !== null}
  <p class="text-xs text-text-muted">Recorded on {matterName}.</p>
{/if}

<div class="flex flex-col gap-8">
  <Label for="communication-description">Description</Label>
  <!-- One word for both types. On a text it is what the message said; on a call it is what the
       member wrote down. The record keeps the two in different columns so a read never has to ask
       which it is holding, and the person typing does not have to care. -->
  <Textarea
    id="communication-description"
    rows={4}
    disabled={busy}
    placeholder={placeholderOf("Description")}
    bind:value={draft.description}
  />
</div>
