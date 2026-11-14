<script lang="ts">
  /*
   * The postal addresses a record holds, and the form that enters another.
   *
   * IT IS ITS OWN SECTION BECAUSE AN ADDRESS IS NOT A FIELD. Every other way to reach somebody is
   * one value on one line; an address is six to nine boxes whose set, words and order are the
   * COUNTRY'S. It used to be a fourth choice in the Contact section's kind dropdown, which meant
   * that dropdown had one option that grew a whole form beneath it and three that did not — so the
   * four read as alike when only one of them is a form, and the section's own list of one-line
   * values had a multi-line thing wedged into it.
   *
   * THE FORM IS THE PLATFORM'S, NOT THIS SCREEN'S. `AddressFields` owns which boxes a country uses
   * and what they are called; this section owns what an address is FOR — whether the firm may use
   * it, whether the place physically exists, which one is the default — which is directory business
   * and belongs nowhere near a design-system component. A second surface that takes an address
   * takes that component, never a copy of this.
   *
   * A RECORDED ADDRESS IS CORRECTED IN PLACE. Pressing a row's pencil loads it back into the form
   * below; the form's commit writes the change. Deleting it and typing it again was the only way
   * before, and it loses the permission, the preference and the confirmation attached to the value
   * along with the mistyped line it was meant to fix.
   *
   * Data-blind, like the Contact section beside it: it lists what it is given and hands a checked
   * draft to whoever owns the record.
   */
  import { administrativeAreasFor } from "@magna-carta/address-formats/administrative-areas";
  import { postalCodeAsTypedFor, postalCodeNoteFor } from "@magna-carta/address-formats/postal-code";
  import AddressFields from "@magna-carta/design-system/address-fields";
  import { addressLookup } from "$lib/addresses/address-lookup-source.ts";
  import { googleMapsLinkFor } from "$lib/addresses/google-maps-link.ts";
  import type { AddressParts } from "@magna-carta/design-system/address-fields";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import Ban from "@lucide/svelte/icons/ban";
  import Check from "@lucide/svelte/icons/check";
  import MapIcon from "@lucide/svelte/icons/map";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import PenLine from "@lucide/svelte/icons/pen-line";
  import Plus from "@lucide/svelte/icons/plus";
  import Star from "@lucide/svelte/icons/star";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import {
    contactDraftRefusal,
    emptyContactDraft,
    type AddressDraft,
    type ContactRow,
  } from "../contact-draft.ts";
  import type { DirectoryAddressUse } from "../directory-api.ts";
  import { ADDRESS_USES } from "../directory-vocabulary.ts";
  import { phoneCountries } from "../phone-entry.ts";

  let {
    rows,
    canEdit = true,
    editDisabledReason,
    busyId = null,
    onAdd,
    onEdit,
    onChange,
    onRemove,
    onPreferred,
    onPermitted,
  }: {
    rows: readonly ContactRow[];
    canEdit?: boolean;
    editDisabledReason?: string;
    busyId?: string | null;
    onAdd: (draft: AddressDraft) => void;
    /** The draft this row should be corrected into. Offered where a correction can be written. */
    onEdit?: (row: ContactRow) => AddressDraft;
    onChange?: (row: ContactRow, draft: AddressDraft) => void;
    onRemove?: (row: ContactRow) => void;
    onPreferred?: (row: ContactRow) => void;
    onPermitted?: (row: ContactRow, permitted: boolean) => void;
  } = $props();

  // The two closed choices this section asks, as the product's one typed picker takes them.
  const useOptions = ADDRESS_USES.map((entry) => ({ value: entry.value, label: entry.label }));

  // The country list is the phone field's, which is every country the number formatter knows —
  // one list, so a record's address and its number never offer different sets of countries.
  const countryItems = phoneCountries().map((country) => ({
    code: country.region,
    name: country.name,
  }));

  // Real addresses offered from the street box as it is typed into. With no address service
  // provisioned the lookup answers "unavailable" and the box stays the plain box it always was.
  const streetLookup = addressLookup();

  function blank(): AddressDraft {
    return emptyContactDraft("address") as AddressDraft;
  }

  let draft = $state<AddressDraft>(blank());
  let correcting = $state<ContactRow | null>(null);
  /**
   * Whether the entry form is open. It starts closed, as an Add Address button, and closes again
   * once the address is added (owner ruling 2026-11-13: "just make an add ... button, at which point the fields would populate. this reduces clutter"). A correction opens it too.
   */
  let adding = $state(false);

  const correctable = $derived(onEdit !== undefined && onChange !== undefined);
  const refusal = $derived(contactDraftRefusal(draft));

  /*
   * The form's own view of the draft: the address LINES, which is exactly what the component owns.
   * The use and the type stay out of it — they are what the firm does with the address, not part of
   * the address — and are asked for beneath it.
   */
  const parts = $derived<AddressParts>({
    recipient: draft.recipient,
    organizationName: draft.organizationName,
    street: draft.street,
    streetTwo: draft.streetTwo,
    dependentLocality: draft.dependentLocality,
    city: draft.city,
    region: draft.region,
    postal: draft.postal,
    sortingCode: draft.sortingCode,
    country: draft.country,
  });

  /*
   * A ZIP code typed first fills in the town and the state (owner request 2026-11-13). Only blanks
   * are filled, so nothing somebody typed is overwritten; the table loads the first time it is
   * needed, because most screens that show an address never use it.
   */
  async function fillFromPostalCode(next: AddressParts): Promise<void> {
    if ((next.country ?? "US") !== "US") return;
    if ((next.city ?? "").trim() !== "" && (next.region ?? "").trim() !== "") return;
    const { usPostalPlaceFor } = await import("@magna-carta/address-formats/us-postal-places");
    const place = usPostalPlaceFor(next.postal ?? "");
    // The draft may have moved on while the table loaded: fill only what is still blank, and only
    // while the code that asked is still the one in the box.
    if (place === null || draft.postal !== (next.postal ?? "")) return;
    draft = {
      ...draft,
      city: draft.city.trim() === "" ? place.city : draft.city,
      region: draft.region.trim() === "" ? place.region : draft.region,
    };
  }

  function takeParts(next: AddressParts): void {
    const postalChanged = (next.postal ?? "") !== draft.postal;
    if (postalChanged) void fillFromPostalCode(next);
    draft = {
      ...draft,
      recipient: next.recipient ?? "",
      organizationName: next.organizationName ?? "",
      street: next.street ?? "",
      streetTwo: next.streetTwo ?? "",
      dependentLocality: next.dependentLocality ?? "",
      city: next.city ?? "",
      region: next.region ?? "",
      postal: next.postal ?? "",
      sortingCode: next.sortingCode ?? "",
      country: next.country ?? draft.country,
    };
  }

  function correct(row: ContactRow): void {
    if (onEdit === undefined) return;
    draft = onEdit(row);
    correcting = row;
  }

  function abandonCorrection(): void {
    correcting = null;
    adding = false;
    draft = blank();
  }

  function commit(): void {
    if (refusal !== null || !canEdit) return;
    if (correcting !== null) {
      onChange?.(correcting, draft);
      abandonCorrection();
      return;
    }
    onAdd(draft);
    draft = blank();
    adding = false;
  }
</script>

<section class="flex flex-col gap-12">
  {#if rows.length > 0}
    <ul class="flex flex-col">
      {#each rows as row (row.id)}
        {@const beingCorrected = correcting?.id === row.id}
        {@const mapsLink = googleMapsLinkFor(row.value)}
        <li
          class="flex items-center gap-8 border-b border-border-default py-4"
          class:text-text-muted={beingCorrected}
        >
          <MapPin class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
          <span class="sr-only">Address</span>
          <span class="flex min-w-0 flex-auto flex-wrap items-baseline gap-x-8">
            <span>{row.value}</span>
            {#if row.use !== null}
              <span class="text-xs text-text-muted">{row.use}</span>
            {/if}
            {#if row.state.note !== null}
              <span class="text-xs text-text-muted">{row.state.note}</span>
            {/if}
            {#if beingCorrected}
              <span class="text-xs text-text-muted">Being corrected below</span>
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
          <span class="flex shrink-0 items-center">
            <!-- Opens the address in Google Maps in a new window (owner request 2026-11-13). A plain
                 link, so it works for anyone who can see the address, editing or not. -->
            {#if mapsLink !== null}
              <Button
                variant="ghost"
                size="icon"
                href={mapsLink}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in Google Maps"
                aria-label="Open {row.value} in Google Maps"
              >
                <MapIcon class="size-16" aria-hidden="true" />
              </Button>
            {/if}
            {#if correctable}
              <Button
                variant="ghost"
                size="icon"
                disabled={!canEdit || busyId === row.id || beingCorrected}
                title={editDisabledReason ?? "Correct this"}
                aria-label="Correct {row.value}"
                onclick={() => correct(row)}
              >
                <PenLine class="size-16" aria-hidden="true" />
              </Button>
            {/if}
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
        </li>
      {/each}
    </ul>
  {/if}

  {#if !adding && correcting === null}
    <div>
      <Button variant="secondary" size="sm" disabled={!canEdit} onclick={() => (adding = true)}>
        <Plus class="size-16" aria-hidden="true" />
        Add Address
      </Button>
    </div>
  {:else}
  <div class="flex flex-col gap-12">
    <AddressFields
      bind:value={() => parts, takeParts}
      countries={countryItems}
      administrativeAreas={administrativeAreasFor(parts.country)}
      postalCodeNote={postalCodeNoteFor}
      postalCodeAsTyped={postalCodeAsTypedFor}
      lookup={streetLookup}
      disabled={!canEdit}
    />

    <!-- What the address is for, beneath the address itself. Whether it is a physical place or a
         mailing address is not asked here (owner ruling 2026-11-13): a new address is recorded as a
         physical place, and a correction keeps whatever the address already held. -->
    <div class="flex flex-wrap items-end gap-8">
      <div style="width: 10rem">
        <LabelledField label="Type">
          {#snippet children({ props })}
            <ChoicePicker
              options={useOptions}
              inputId={props.id}
              label="Type"
              disabled={!canEdit}
              bind:value={
                () => draft.use, (chosen) => (draft = { ...draft, use: chosen as DirectoryAddressUse })
              }
            />
          {/snippet}
        </LabelledField>
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="ms-auto"
        title={correcting === null ? "Cancel" : "Leave it as it is"}
        aria-label={correcting === null ? "Cancel adding an address" : "Leave this address as it is"}
        onclick={abandonCorrection}
      >
        <X class="size-16" aria-hidden="true" />
      </Button>
      <Button
        variant="secondary"
        size="icon"
        disabled={!canEdit || refusal !== null}
        title={editDisabledReason ?? refusal ?? (correcting === null ? "Add" : "Save the correction")}
        aria-label={correcting === null ? "Add this address" : "Save this correction"}
        onclick={commit}
      >
        {#if correcting === null}
          <Plus class="size-16" aria-hidden="true" />
        {:else}
          <Check class="size-16" aria-hidden="true" />
        {/if}
      </Button>
    </div>
  </div>
  {/if}
</section>
