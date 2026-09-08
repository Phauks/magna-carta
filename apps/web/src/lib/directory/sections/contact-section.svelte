<script lang="ts">
  /*
   * How the firm can reach someone: one dense list, and one add row whose KIND comes first.
   *
   * Every way to reach a person is one line: the kind as a glyph, the value formatted, the use
   * beside it, the record's marks after, and the row's own controls at the end. The add row asks
   * the kind first — Email, Telephone, Fax, Address — and the kind decides the fields; each kind
   * checks its own shape before the plus is live, by the rule the API applies (contact-draft.ts).
   *
   * Data-blind: it lists what it is given and hands a checked draft to whoever owns the record.
   * The New Person dialog keeps the drafts until one commit records them all; the record's Contact
   * pane records each one as it is added. Neither knows the other exists.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Ban from "@lucide/svelte/icons/ban";
  import Mail from "@lucide/svelte/icons/mail";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Phone from "@lucide/svelte/icons/phone";
  import Plus from "@lucide/svelte/icons/plus";
  import Printer from "@lucide/svelte/icons/printer";
  import Star from "@lucide/svelte/icons/star";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import {
    CONTACT_KINDS,
    contactDraftRefusal,
    contactDraftStarted,
    emptyContactDraft,
    FAX_USES,
    TELEPHONE_USES,
    type ContactDraft,
    type ContactKind,
    type ContactRow,
  } from "../contact-draft.ts";
  import type {
    DirectoryAddressType,
    DirectoryAddressUse,
    DirectoryContactUse,
  } from "../directory-api.ts";
  import { ADDRESS_TYPES, ADDRESS_USES, EMAIL_USES } from "../directory-vocabulary.ts";
  import { phoneCountries } from "../phone-entry.ts";
  import PhoneNumberField from "../phone-number-field.svelte";
  import SectionHeading from "./section-heading.svelte";

  let {
    rows,
    canEdit = true,
    editDisabledReason,
    busyId = null,
    onAdd,
    onRemove,
    onPreferred,
    onPermitted,
  }: {
    rows: readonly ContactRow[];
    canEdit?: boolean;
    editDisabledReason?: string;
    /** The row a write is in flight for; its controls wait. */
    busyId?: string | null;
    /** A checked draft. The owner records it, or keeps it until the record exists. */
    onAdd: (draft: ContactDraft) => void;
    onRemove?: (row: ContactRow) => void;
    /** Make this the preferred way to reach them. Offered only where the owner can record it. */
    onPreferred?: (row: ContactRow) => void;
    onPermitted?: (row: ContactRow, permitted: boolean) => void;
  } = $props();

  const identity = $props.id();
  const kindLabelId = `${identity}-kind`;
  const useLabelId = `${identity}-use`;
  const addressUseLabelId = `${identity}-address-use`;
  const addressTypeLabelId = `${identity}-address-type`;

  let draft = $state<ContactDraft>(emptyContactDraft("email"));

  function startDraft(kind: ContactKind): void {
    draft = emptyContactDraft(kind);
  }

  /** One patch for every kind: the union's readonly fields are replaced, never mutated. */
  function patch(changes: Record<string, string>): void {
    draft = { ...draft, ...changes } as ContactDraft;
  }

  const refusal = $derived(contactDraftRefusal(draft));
  const started = $derived(contactDraftStarted(draft));
  /** The refusal, on the field it is about, once something has been typed. */
  const fieldError = $derived(started && refusal !== null ? refusal : undefined);
  const kindItems = CONTACT_KINDS.map((entry) => ({ value: entry.value, label: entry.label }));
  // The country list is the phone module's, because it is the same list of countries; nothing about
  // an address's country differs from a number's country except how it is written down.
  const addressCountryItems = phoneCountries().map((country) => ({
    value: country.region,
    label: country.name,
  }));
  const addressCountryLabelId = `${identity}-address-country`;
  const useItems = $derived([
    ...(draft.kind === "email"
      ? EMAIL_USES
      : draft.kind === "telephone"
        ? TELEPHONE_USES
        : draft.kind === "fax"
          ? FAX_USES
          : []),
  ]);
  const addressUseItems = [...ADDRESS_USES];
  const addressTypeItems = [...ADDRESS_TYPES];

  function add(): void {
    if (refusal !== null || !canEdit) return;
    onAdd(draft);
    draft = emptyContactDraft(draft.kind);
  }

  function glyphOf(kind: ContactKind) {
    switch (kind) {
      case "email":
        return Mail;
      case "telephone":
        return Phone;
      case "fax":
        return Printer;
      case "address":
        return MapPin;
    }
  }
</script>

<section class="flex flex-col gap-12">
  <SectionHeading label="Ways To Reach Them" count={rows.length} />

  {#if rows.length > 0}
    <ul class="flex flex-col">
      {#each rows as row (row.id)}
        {@const Glyph = glyphOf(row.kind)}
        <li class="flex items-center gap-8 border-b border-border-default py-4">
          <Glyph class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
          <span class="sr-only">{CONTACT_KINDS.find((entry) => entry.value === row.kind)?.label}</span>
          <span class="flex min-w-0 flex-auto flex-wrap items-baseline gap-x-8">
            <span class={row.kind === "telephone" || row.kind === "fax" ? "tabular-nums" : ""}>
              {row.value}
            </span>
            {#if row.use !== null}
              <span class="text-xs text-text-muted">{row.use}</span>
            {/if}
            {#if row.state.note !== null}
              <span class="text-xs text-text-muted">{row.state.note}</span>
            {/if}
          </span>
          <span class="flex shrink-0 items-center gap-4">
            {#if row.state.preferred}
              <Badge variant="accent">Preferred</Badge>
            {/if}
            {#if !row.state.permitted}
              <Badge variant="warning">Do not use</Badge>
            {/if}
            {#if row.state.verificationStatus === "failed"}
              <Badge variant="danger">
                <TriangleAlert class="size-12" aria-hidden="true" />
                Did not reach
              </Badge>
            {:else if row.state.verificationStatus === "verified"}
              <Badge variant="success">Confirmed</Badge>
            {/if}
          </span>
          {#if onPreferred !== undefined || onPermitted !== undefined || onRemove !== undefined}
            <span class="flex shrink-0 items-center">
              {#if onPreferred !== undefined && !row.state.preferred}
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!canEdit || busyId === row.id}
                  title={editDisabledReason ?? "Make this the preferred way to reach them"}
                  aria-label="Prefer {row.value}"
                  onclick={() => onPreferred?.(row)}
                >
                  <Star class="size-16" aria-hidden="true" />
                </Button>
              {/if}
              {#if onPermitted !== undefined}
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!canEdit || busyId === row.id}
                  title={editDisabledReason ??
                    (row.state.permitted
                      ? "Record that the firm should not use this"
                      : "Record that the firm may use this again")}
                  aria-label={row.state.permitted
                    ? `Record do not use for ${row.value}`
                    : `Record may be used for ${row.value}`}
                  onclick={() => onPermitted?.(row, !row.state.permitted)}
                >
                  <Ban class="size-16" aria-hidden="true" />
                </Button>
              {/if}
              {#if onRemove !== undefined}
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!canEdit || busyId === row.id}
                  title={editDisabledReason ?? "Remove"}
                  aria-label="Remove {row.value}"
                  onclick={() => onRemove?.(row)}
                >
                  <Trash2 class="size-16" aria-hidden="true" />
                </Button>
              {/if}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <!-- The kind first; the fields it decides; the plus live once the value fits. -->
  <div class="flex flex-col gap-12 rounded-md border border-border-default bg-surface-raised p-12">
    <div class="flex flex-wrap items-end gap-8">
      <div class="flex flex-col gap-8" style="width: 8rem">
        <Label id={kindLabelId}>Kind</Label>
        <Select.Root
          type="single"
          items={kindItems}
          bind:value={() => draft.kind, (chosen) => startDraft(chosen as ContactKind)}
          allowDeselect={false}
          disabled={!canEdit}
        >
          <Select.Trigger aria-labelledby={kindLabelId}>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each kindItems as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      {#if draft.kind === "email"}
        {@const email = draft}
        <LabelledField label="Address" class="min-w-0 flex-auto" error={fieldError}>
          {#snippet children({ props })}
            <Input
              {...props}
              type="email"
              autocomplete="off"
              value={email.address}
              disabled={!canEdit}
              placeholder={placeholderOf("Address")}
              oninput={(event) => patch({ address: event.currentTarget.value })}
            />
          {/snippet}
        </LabelledField>
      {:else if draft.kind === "telephone" || draft.kind === "fax"}
        {@const number = draft}
        <!-- The country, the digits AND the extension are ONE field, and it is the same one the call
             log enters a number in (../phone-number-field.svelte). Two hand-built copies of this
             pair is how the two came to format a deletion differently; the extension was the last
             half still built here, and building it here is why typing a direct dial onto the end of
             a number stopped the grouping instead of rolling into it. -->
        <div class="min-w-0 flex-auto">
          <PhoneNumberField
            bind:region={() => number.region, (chosen) => patch({ region: chosen })}
            bind:number={() => number.number, (typed) => patch({ number: typed })}
            bind:extension={() => number.extension, (typed) => patch({ extension: typed })}
            disabled={!canEdit}
            error={fieldError}
          />
        </div>
      {/if}

      {#if draft.kind !== "address"}
        {@const chosenUse = draft.use}
        <div class="flex flex-col gap-8" style="width: 7.5rem">
          <Label id={useLabelId}>Use</Label>
          <Select.Root
            type="single"
            items={useItems}
            bind:value={() => chosenUse, (chosen) => patch({ use: chosen as DirectoryContactUse })}
            allowDeselect={false}
            disabled={!canEdit}
          >
            <Select.Trigger aria-labelledby={useLabelId}>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {#each useItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <Button
          variant="secondary"
          size="icon"
          disabled={!canEdit || refusal !== null}
          title={editDisabledReason ?? refusal ?? "Add"}
          aria-label="Add this way to reach them"
          onclick={add}
        >
          <Plus class="size-16" aria-hidden="true" />
        </Button>
      {/if}
    </div>

    {#if draft.kind === "address"}
      {@const address = draft}
      <div class="grid gap-8 sm:grid-cols-2">
        <LabelledField label="Street" error={fieldError}>
          {#snippet children({ props })}
            <Input {...props} value={address.street} disabled={!canEdit} placeholder={placeholderOf("Street")} oninput={(event) => patch({ street: event.currentTarget.value })} />
          {/snippet}
        </LabelledField>
        <LabelledField label="Suite or unit">
          {#snippet children({ props })}
            <Input {...props} value={address.streetTwo} disabled={!canEdit} placeholder={placeholderOf("Suite or unit")} oninput={(event) => patch({ streetTwo: event.currentTarget.value })} />
          {/snippet}
        </LabelledField>
      </div>
      <div class="grid gap-8" style="grid-template-columns: minmax(0, 1fr) 6rem 6rem 10rem">
        <LabelledField label="City">
          {#snippet children({ props })}
            <Input {...props} value={address.city} disabled={!canEdit} placeholder={placeholderOf("City")} oninput={(event) => patch({ city: event.currentTarget.value })} />
          {/snippet}
        </LabelledField>
        <LabelledField label="Region">
          {#snippet children({ props })}
            <Input {...props} value={address.region} disabled={!canEdit} placeholder={placeholderOf("Region")} oninput={(event) => patch({ region: event.currentTarget.value })} />
          {/snippet}
        </LabelledField>
        <LabelledField label="Postal">
          {#snippet children({ props })}
            <Input {...props} class="tabular-nums" value={address.postal} disabled={!canEdit} placeholder={placeholderOf("Postal")} oninput={(event) => patch({ postal: event.currentTarget.value })} />
          {/snippet}
        </LabelledField>
        <div class="flex flex-col gap-8">
          <Label id={addressCountryLabelId}>Country</Label>
          <Select.Root type="single" items={addressCountryItems} bind:value={() => address.country, (chosen) => patch({ country: chosen })} allowDeselect={false} disabled={!canEdit}>
            <Select.Trigger aria-labelledby={addressCountryLabelId}><Select.Value /></Select.Trigger>
            <Select.Content>
              {#each addressCountryItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
      <div class="flex flex-wrap items-end gap-8">
        <div class="flex flex-col gap-8" style="width: 10rem">
          <Label id={addressUseLabelId}>Use</Label>
          <Select.Root type="single" items={addressUseItems} bind:value={() => address.use, (chosen) => patch({ use: chosen as DirectoryAddressUse })} allowDeselect={false} disabled={!canEdit}>
            <Select.Trigger aria-labelledby={addressUseLabelId}><Select.Value /></Select.Trigger>
            <Select.Content>
              {#each ADDRESS_USES as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="flex flex-col gap-8" style="width: 11rem">
          <Label id={addressTypeLabelId}>Type</Label>
          <Select.Root type="single" items={addressTypeItems} bind:value={() => address.type, (chosen) => patch({ type: chosen as DirectoryAddressType })} allowDeselect={false} disabled={!canEdit}>
            <Select.Trigger aria-labelledby={addressTypeLabelId}><Select.Value /></Select.Trigger>
            <Select.Content>
              {#each ADDRESS_TYPES as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <Button
          variant="secondary"
          size="icon"
          class="ms-auto"
          disabled={!canEdit || refusal !== null}
          title={editDisabledReason ?? refusal ?? "Add"}
          aria-label="Add this address"
          onclick={add}
        >
          <Plus class="size-16" aria-hidden="true" />
        </Button>
      </div>
    {/if}

  </div>
</section>
