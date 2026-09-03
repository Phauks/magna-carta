<script lang="ts">
  /*
   * How the firm can reach this record — email addresses, telephone and fax numbers, and postal
   * addresses.
   *
   * THIS PANE IS THE CAPABILITY. The three tables behind it have been in the schema since the
   * beginning with nothing able to write to them, so until this existed a firm could not record a
   * client's telephone number.
   *
   * CAN AND SHOULD ARE TWO DIFFERENT FACTS, and the pane keeps them apart because a firm acts on
   * them differently. A contact point can be PERMITTED — may the firm use it at all — and one
   * contact point across all three channels can be PREFERRED, the route the person asked to be
   * reached by. A person can be reachable at a number they would rather nobody rang, and can ask to
   * be reached by post while their email address stays perfectly usable. Withdrawing the permission
   * is what the pane offers instead of deleting: deleting the number loses the instruction along
   * with the value, and the next member types it back in and rings it.
   *
   * A FAILED CONFIRMATION IS SHOWN AND GATES NOTHING. Returned mail and a bounced message are the
   * facts a firm most needs recorded, and they are also frequently wrong about the future. So the
   * row says so, in the calm status register, and nothing anywhere refuses to send.
   *
   * WHAT WAS ENTERED IS WHAT IS SHOWN. A telephone number is rendered exactly as it was typed; the
   * split into country code and national number is storage, for a dialler, and a screen that
   * reformatted a client's number would be arguing with the person who wrote it down.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldRow from "@magna-carta/design-system/field-row";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Textarea from "@magna-carta/design-system/textarea";
  import AtSign from "@lucide/svelte/icons/at-sign";
  import Ban from "@lucide/svelte/icons/ban";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Phone from "@lucide/svelte/icons/phone";
  import Plus from "@lucide/svelte/icons/plus";
  import Star from "@lucide/svelte/icons/star";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import {
    addDirectoryAddress,
    addDirectoryEmail,
    addDirectoryPhone,
    readDirectoryContactPoints,
    removeDirectoryContactPoint,
    updateDirectoryContactPoint,
    type DirectoryAddressType,
    type DirectoryAddressUse,
    type DirectoryContactPointState,
    type DirectoryContactPoints,
    type DirectoryContactUse,
  } from "./directory-api.ts";
  import {
    ADDRESS_TYPES,
    ADDRESS_USES,
    EMAIL_USES,
    PHONE_KINDS,
    addressLines,
    addressTypeLabel,
    addressUseLabel,
    contactUseLabel,
    phoneKindLabel,
  } from "./directory-vocabulary.ts";

  let {
    entityId,
    mayEdit,
    editDisabledReason,
  }: {
    entityId: string;
    mayEdit: boolean;
    editDisabledReason?: string;
  } = $props();

  // ---- what the firm holds ----------------------------------------------------------------------

  let points = $state<DirectoryContactPoints | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let reloadToken = $state(0);

  $effect(() => {
    const id = entityId;
    void reloadToken;
    let cancelled = false;
    points = null;
    readFailure = null;
    void (async () => {
      const outcome = await readDirectoryContactPoints(fetch, id);
      if (cancelled) return;
      if (outcome.kind === "ok") {
        points = outcome.value;
        return;
      }
      points = { emails: [], phones: [], addresses: [] };
      readFailure = stated(outcome.failure, "How to reach this record could not be read.");
    })();
    return () => {
      cancelled = true;
    };
  });

  const total = $derived(
    points === null
      ? 0
      : points.emails.length + points.phones.length + points.addresses.length,
  );

  // ---- recording one -----------------------------------------------------------------------------

  type Channel = "emails" | "phones" | "addresses";

  let open = $state(false);
  let channel = $state<Channel>("phones");
  let failure = $state<StatedFailure | null>(null);

  let emailAddress = $state("");
  let emailUse = $state<DirectoryContactUse>("work");

  let phoneNumber = $state("");
  let phoneKind = $state("mobile");
  let phoneExtension = $state("");

  let addressStreet = $state("");
  let addressStreetTwo = $state("");
  let addressDependentLocality = $state("");
  let addressCity = $state("");
  let addressRegion = $state("");
  let addressPostal = $state("");
  let addressSortingCode = $state("");
  let addressCountry = $state("");
  let addressUse = $state<DirectoryAddressUse>("business");
  let addressType = $state<DirectoryAddressType>("physical");

  let makePrimary = $state(false);
  let makePreferred = $state(false);
  let permitted = $state(true);
  let preferenceNote = $state("");

  const channelItems = [
    { value: "phones", label: "Telephone or fax" },
    { value: "emails", label: "Email" },
    { value: "addresses", label: "Postal address" },
  ];

  function resetDraft(startingChannel: Channel): void {
    channel = startingChannel;
    failure = null;
    emailAddress = "";
    emailUse = "work";
    phoneNumber = "";
    phoneKind = "mobile";
    phoneExtension = "";
    addressStreet = "";
    addressStreetTwo = "";
    addressDependentLocality = "";
    addressCity = "";
    addressRegion = "";
    addressPostal = "";
    addressSortingCode = "";
    addressCountry = "";
    addressUse = "business";
    addressType = "physical";
    makePrimary = false;
    makePreferred = false;
    permitted = true;
    preferenceNote = "";
  }

  const addressHasSomething = $derived(
    [
      addressStreet,
      addressStreetTwo,
      addressDependentLocality,
      addressCity,
      addressRegion,
      addressPostal,
      addressSortingCode,
      addressCountry,
    ].some((part) => part.trim() !== ""),
  );

  const readyToRecord = $derived(
    channel === "emails"
      ? emailAddress.trim() !== ""
      : channel === "phones"
        ? phoneNumber.trim() !== ""
        : addressHasSomething,
  );

  const refusal = $derived.by((): string | undefined => {
    if (readyToRecord) return undefined;
    if (channel === "emails") return "An address is required.";
    if (channel === "phones") return "A number is required.";
    return "At least one part of the address is required.";
  });

  /** Whether anything has been typed: what the guard asks about before a stray Escape. */
  const started = $derived(
    emailAddress.trim() !== "" ||
      phoneNumber.trim() !== "" ||
      phoneExtension.trim() !== "" ||
      addressHasSomething ||
      preferenceNote.trim() !== "",
  );

  function preferenceForDraft() {
    return {
      permitted,
      preferred: makePreferred,
      note: preferenceNote.trim() === "" ? null : preferenceNote.trim(),
    };
  }

  async function record(): Promise<ActionOutcome> {
    if (!readyToRecord) return "refused";
    failure = null;
    const key = crypto.randomUUID();
    const preference = preferenceForDraft();

    const outcome =
      channel === "emails"
        ? await addDirectoryEmail(
            fetch,
            entityId,
            {
              address: emailAddress.trim(),
              contactUse: emailUse,
              isPrimary: makePrimary,
              preference,
            },
            key,
          )
        : channel === "phones"
          ? await addDirectoryPhone(
              fetch,
              entityId,
              {
                number: phoneNumber.trim(),
                contactSystem: PHONE_KINDS.find((entry) => entry.value === phoneKind)?.system,
                contactUse: PHONE_KINDS.find((entry) => entry.value === phoneKind)?.use ?? null,
                extension: phoneExtension.trim() === "" ? null : phoneExtension.trim(),
                isPrimary: makePrimary,
                preference,
              },
              key,
            )
          : await addDirectoryAddress(
              fetch,
              entityId,
              {
                street: addressStreet.trim() === "" ? null : addressStreet.trim(),
                streetTwo: addressStreetTwo.trim() === "" ? null : addressStreetTwo.trim(),
                dependentLocality:
                  addressDependentLocality.trim() === "" ? null : addressDependentLocality.trim(),
                city: addressCity.trim() === "" ? null : addressCity.trim(),
                region: addressRegion.trim() === "" ? null : addressRegion.trim(),
                postal: addressPostal.trim() === "" ? null : addressPostal.trim(),
                sortingCode: addressSortingCode.trim() === "" ? null : addressSortingCode.trim(),
                country:
                  addressCountry.trim() === "" ? null : addressCountry.trim().toUpperCase(),
                addressUse,
                addressType,
                isPrimary: makePrimary,
                preference,
              },
              key,
            );

    if (outcome.kind === "ok") {
      reloadToken += 1;
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "This could not be recorded.",
      "Nothing was recorded.",
    );
    return "refused";
  }

  // ---- changing one ------------------------------------------------------------------------------

  let busyContactPointId = $state<string | null>(null);
  let actionFailure = $state<StatedFailure | null>(null);

  async function setPermission(
    forChannel: Channel,
    contactPointId: string,
    nextPermitted: boolean,
  ): Promise<void> {
    busyContactPointId = contactPointId;
    actionFailure = null;
    const outcome = await updateDirectoryContactPoint(
      fetch,
      forChannel,
      contactPointId,
      { preference: { permitted: nextPermitted } },
      crypto.randomUUID(),
    );
    busyContactPointId = null;
    if (outcome.kind === "ok") {
      reloadToken += 1;
      return;
    }
    actionFailure = stated(
      outcome.failure,
      "That could not be changed.",
      "Nothing changed.",
    );
  }

  async function remove(forChannel: Channel, contactPointId: string): Promise<void> {
    busyContactPointId = contactPointId;
    actionFailure = null;
    const outcome = await removeDirectoryContactPoint(
      fetch,
      forChannel,
      contactPointId,
      crypto.randomUUID(),
    );
    busyContactPointId = null;
    if (outcome.kind === "ok") {
      reloadToken += 1;
      return;
    }
    actionFailure = stated(
      outcome.failure,
      "That could not be removed.",
      "Nothing was removed.",
    );
  }
</script>

{#snippet marks(state: DirectoryContactPointState, isPrimary: boolean)}
  <span class="flex flex-wrap items-center gap-8">
    {#if state.preferred}
      <!-- The subtle register: a preference is a fact about the record, not an interruption. -->
      <Badge variant="accent">
        <Star class="size-12" aria-hidden="true" />
        Preferred
      </Badge>
    {/if}
    {#if isPrimary}
      <Badge variant="neutral">Default</Badge>
    {/if}
    {#if !state.permitted}
      <Badge variant="warning">
        <Ban class="size-12" aria-hidden="true" />
        Do not use
      </Badge>
    {/if}
    {#if state.verificationStatus === "failed"}
      <Badge variant="danger">
        <TriangleAlert class="size-12" aria-hidden="true" />
        Did not reach
      </Badge>
    {:else if state.verificationStatus === "verified"}
      <Badge variant="success">Confirmed</Badge>
    {/if}
  </span>
{/snippet}

{#snippet aside(state: DirectoryContactPointState)}
  {#if state.note !== null || state.verificationDetail !== null}
    <span class="block text-xs text-text-muted">
      {state.note ?? state.verificationDetail}
    </span>
  {/if}
{/snippet}

{#snippet rowActions(forChannel: Channel, contactPointId: string, isPermitted: boolean)}
  <span class="flex items-center justify-end gap-4">
    <Button
      variant="ghost"
      size="icon"
      disabled={!mayEdit || busyContactPointId === contactPointId}
      title={editDisabledReason ??
        (isPermitted
          ? "Record that the firm should not use this"
          : "Record that the firm may use this again")}
      aria-label={isPermitted ? "Record do not use" : "Record may be used"}
      onclick={() => void setPermission(forChannel, contactPointId, !isPermitted)}
    >
      <Ban class="size-16" aria-hidden="true" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      disabled={!mayEdit || busyContactPointId === contactPointId}
      title={editDisabledReason ?? "Remove this from the record"}
      aria-label="Remove"
      onclick={() => void remove(forChannel, contactPointId)}
    >
      <Trash2 class="size-16" aria-hidden="true" />
    </Button>
  </span>
{/snippet}

<section class="flex flex-col gap-16">
  <div class="flex items-center justify-between gap-16">
    <h3 class="text-sm font-semibold">Contact</h3>
    <Button
      variant="secondary"
      disabled={!mayEdit}
      title={editDisabledReason}
      onclick={() => {
        resetDraft("phones");
        open = true;
      }}
    >
      <Plus class="size-16" aria-hidden="true" />
      Record a way to reach them
    </Button>
  </div>

  {#if readFailure !== null}
    <FailureNotice
      failure={readFailure.failure}
      title="This Record's Contact Details Could Not Be Read"
      fallback={readFailure.fallback}
      whenSilent={readFailure.whenSilent}
    />
  {:else if points === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Reading how to reach this record">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if total === 0}
    <EmptyState title="No Way To Reach This Record">
      The firm holds no email address, telephone number or postal address for this record. Recording
      one keeps the firm's own instruction with it: a number can be held and marked not to be used.
    </EmptyState>
  {:else}
    {#if actionFailure !== null}
      <FailureNotice
        failure={actionFailure.failure}
        title="That Could Not Be Changed"
        fallback={actionFailure.fallback}
        whenSilent={actionFailure.whenSilent}
      />
    {/if}

    {#if points.phones.length > 0}
      <DataTable.Root>
        <DataTable.Caption class="sr-only">
          The telephone and fax numbers this record holds
        </DataTable.Caption>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Telephone</DataTable.Head>
            <DataTable.Head>Kind</DataTable.Head>
            <DataTable.Head>Standing</DataTable.Head>
            <DataTable.Head data-align="end">Change</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each points.phones as entry (entry.id)}
            <DataTable.Row>
              <DataTable.Cell>
                <span class="flex items-center gap-8">
                  <Phone class="size-16 text-text-muted" aria-hidden="true" />
                  <span class="tabular-nums">{entry.number}</span>
                  {#if entry.extension !== null}
                    <span class="text-xs text-text-muted">extension {entry.extension}</span>
                  {/if}
                </span>
                {@render aside(entry.state)}
              </DataTable.Cell>
              <DataTable.Cell>{phoneKindLabel(entry.contactSystem, entry.contactUse)}</DataTable.Cell>
              <DataTable.Cell>{@render marks(entry.state, entry.isPrimary)}</DataTable.Cell>
              <DataTable.Cell data-align="end">
                {@render rowActions("phones", entry.id, entry.state.permitted)}
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    {/if}

    {#if points.emails.length > 0}
      <DataTable.Root>
        <DataTable.Caption class="sr-only">The email addresses this record holds</DataTable.Caption>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Email</DataTable.Head>
            <DataTable.Head>Kind</DataTable.Head>
            <DataTable.Head>Standing</DataTable.Head>
            <DataTable.Head data-align="end">Change</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each points.emails as entry (entry.id)}
            <DataTable.Row>
              <DataTable.Cell>
                <span class="flex items-center gap-8">
                  <AtSign class="size-16 text-text-muted" aria-hidden="true" />
                  {entry.address}
                </span>
                {@render aside(entry.state)}
              </DataTable.Cell>
              <DataTable.Cell>
                {entry.contactUse === null ? "" : contactUseLabel(entry.contactUse)}
              </DataTable.Cell>
              <DataTable.Cell>{@render marks(entry.state, entry.isPrimary)}</DataTable.Cell>
              <DataTable.Cell data-align="end">
                {@render rowActions("emails", entry.id, entry.state.permitted)}
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    {/if}

    {#if points.addresses.length > 0}
      <DataTable.Root>
        <DataTable.Caption class="sr-only">The postal addresses this record holds</DataTable.Caption>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Address</DataTable.Head>
            <DataTable.Head>Kind</DataTable.Head>
            <DataTable.Head>Standing</DataTable.Head>
            <DataTable.Head data-align="end">Change</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each points.addresses as entry (entry.id)}
            <DataTable.Row>
              <DataTable.Cell>
                <span class="flex items-start gap-8">
                  <MapPin class="size-16 text-text-muted" aria-hidden="true" />
                  <span class="flex flex-col">
                    {#each addressLines(entry) as line (line)}
                      <span>{line}</span>
                    {/each}
                  </span>
                </span>
                {@render aside(entry.state)}
              </DataTable.Cell>
              <DataTable.Cell>
                <span class="flex flex-col">
                  <span>{entry.addressUse === null ? "" : addressUseLabel(entry.addressUse)}</span>
                  <span class="text-xs text-text-muted">{addressTypeLabel(entry.addressType)}</span>
                </span>
              </DataTable.Cell>
              <DataTable.Cell>{@render marks(entry.state, entry.isPrimary)}</DataTable.Cell>
              <DataTable.Cell data-align="end">
                {@render rowActions("addresses", entry.id, entry.state.permitted)}
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    {/if}
  {/if}
</section>

<ActionDialog
  bind:open
  kind="form"
  width="wide"
  heading="Record A Way To Reach Them"
  subtitle="A number is stored exactly as it is written here. Nothing is reformatted, and a number this system cannot take apart is still kept and still shown."
  commitLabel="Record"
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  unsavedChanges={started}
  onCommit={record}
>
  {#snippet fields({ busy })}
      <div class="flex flex-col gap-8">
        <Label id="contact-channel-label">What is being recorded</Label>
        <Select.Root
          type="single"
          items={channelItems}
          bind:value={() => channel, (chosen) => (channel = chosen as Channel)}
          allowDeselect={false}
          disabled={busy}
        >
          <Select.Trigger class="min-w-64" aria-labelledby="contact-channel-label">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each channelItems as entry (entry.value)}
              <Select.Item value={entry.value} label={entry.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

    {#if channel === "phones"}
      <FieldRow>
      <LabelledField label="Number">
          {#snippet children({ props })}
            <Input
              {...props}
              disabled={busy}
              bind:value={phoneNumber}
              autocomplete="off"
              placeholder={placeholderOf("Number")}
            />
          {/snippet}
        </LabelledField>
      <LabelledField label="Extension">
          {#snippet children({ props })}
            <Input
              {...props}
              disabled={busy}
              bind:value={phoneExtension}
              autocomplete="off"
              placeholder={placeholderOf("Extension")}
            />
          {/snippet}
        </LabelledField>
      </FieldRow>
      <div class="flex flex-col gap-8">
        <Label id="contact-phone-kind-label">Kind</Label>
        <Select.Root
          type="single"
          items={PHONE_KINDS.map((entry) => ({ value: entry.value, label: entry.label }))}
          bind:value={() => phoneKind, (chosen) => (phoneKind = chosen)}
          allowDeselect={false}
          disabled={busy}
        >
          <Select.Trigger class="min-w-64" aria-labelledby="contact-phone-kind-label">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each PHONE_KINDS as entry (entry.value)}
              <Select.Item value={entry.value} label={entry.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    {:else if channel === "emails"}
      <LabelledField label="Address">
        {#snippet children({ props })}
          <Input
            {...props}
            disabled={busy}
            bind:value={emailAddress}
            autocomplete="off"
            type="email"
            placeholder={placeholderOf("Address")}
          />
        {/snippet}
      </LabelledField>
      <div class="flex flex-col gap-8">
        <Label id="contact-email-use-label">Kind</Label>
        <Select.Root
          type="single"
          items={EMAIL_USES.map((entry) => ({ value: entry.value, label: entry.label }))}
          bind:value={() => emailUse, (chosen) => (emailUse = chosen as DirectoryContactUse)}
          allowDeselect={false}
          disabled={busy}
        >
          <Select.Trigger class="min-w-64" aria-labelledby="contact-email-use-label">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each EMAIL_USES as entry (entry.value)}
              <Select.Item value={entry.value} label={entry.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    {:else}
      <!-- No field is required and none is assumed. Which fields a country's addresses use, what
           they are called and what order they read in are properties of the country, so a
           half-held address is stored as a half-held address rather than refused. -->
      <FieldRow>
      <LabelledField label="Address line">
          {#snippet children({ props })}
            <Input
              {...props}
              disabled={busy}
              bind:value={addressStreet}
              autocomplete="off"
              placeholder={placeholderOf("Address line")}
            />
          {/snippet}
        </LabelledField>
      <LabelledField label="Second address line">
          {#snippet children({ props })}
            <Input
              {...props}
              disabled={busy}
              bind:value={addressStreetTwo}
              autocomplete="off"
              placeholder={placeholderOf("Second address line")}
            />
          {/snippet}
        </LabelledField>
      </FieldRow>
      <FieldRow>
      <LabelledField label="District or neighbourhood">
          {#snippet children({ props })}
            <Input
              {...props}
              disabled={busy}
              bind:value={addressDependentLocality}
              autocomplete="off"
              placeholder={placeholderOf("District or neighbourhood")}
            />
          {/snippet}
        </LabelledField>
      <LabelledField label="Town or city">
          {#snippet children({ props })}
            <Input
              {...props}
              disabled={busy}
              bind:value={addressCity}
              autocomplete="off"
              placeholder={placeholderOf("Town or city")}
            />
          {/snippet}
        </LabelledField>
      </FieldRow>
      <FieldRow>
      <LabelledField label="State, province or region">
          {#snippet children({ props })}
            <Input
              {...props}
              disabled={busy}
              bind:value={addressRegion}
              autocomplete="off"
              placeholder={placeholderOf("State, province or region")}
            />
          {/snippet}
        </LabelledField>
      <LabelledField label="Postal code">
          {#snippet children({ props })}
            <Input
              {...props}
              disabled={busy}
              bind:value={addressPostal}
              autocomplete="off"
              placeholder={placeholderOf("Postal code")}
            />
          {/snippet}
        </LabelledField>
      </FieldRow>
      <FieldRow>
      <LabelledField label="Sorting code">
          {#snippet children({ props })}
            <Input
              {...props}
              disabled={busy}
              bind:value={addressSortingCode}
              autocomplete="off"
              placeholder={placeholderOf("Sorting code")}
            />
          {/snippet}
        </LabelledField>
      <LabelledField label="Country">
          {#snippet children({ props })}
            <Input
              {...props}
              disabled={busy}
              bind:value={addressCountry}
              autocomplete="off"
              maxlength={2}
              placeholder={placeholderOf("Country")}
            />
          {/snippet}
        </LabelledField>
      </FieldRow>
      <FieldRow>
      <div class="flex flex-col gap-8">
          <Label id="contact-address-use-label">Kind</Label>
          <Select.Root
            type="single"
            items={ADDRESS_USES.map((entry) => ({ value: entry.value, label: entry.label }))}
            bind:value={() => addressUse, (chosen) => (addressUse = chosen as DirectoryAddressUse)}
            allowDeselect={false}
            disabled={busy}
          >
            <Select.Trigger class="min-w-64" aria-labelledby="contact-address-use-label">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {#each ADDRESS_USES as entry (entry.value)}
                <Select.Item value={entry.value} label={entry.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      <div class="flex flex-col gap-8">
          <Label id="contact-address-type-label">Whether it can be served</Label>
          <Select.Root
            type="single"
            items={ADDRESS_TYPES.map((entry) => ({ value: entry.value, label: entry.label }))}
            bind:value={() => addressType, (chosen) => (addressType = chosen as DirectoryAddressType)}
            allowDeselect={false}
            disabled={busy}
          >
            <Select.Trigger class="min-w-64" aria-labelledby="contact-address-type-label">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {#each ADDRESS_TYPES as entry (entry.value)}
                <Select.Item value={entry.value} label={entry.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </FieldRow>
    {/if}

    <div class="flex flex-col gap-8">
      <Label class="flex items-center gap-8" for="contact-permitted">
        <Checkbox id="contact-permitted" disabled={busy} bind:checked={permitted} />
        The firm may use this
      </Label>
      <Label class="flex items-center gap-8" for="contact-preferred">
        <Checkbox id="contact-preferred" disabled={busy} bind:checked={makePreferred} />
        This is how they asked to be reached
      </Label>
      <Label class="flex items-center gap-8" for="contact-primary">
        <Checkbox id="contact-primary" disabled={busy} bind:checked={makePrimary} />
        Use this one by default
      </Label>
    </div>

    <LabelledField label="Note">
      {#snippet children({ props })}
        <Textarea
          {...props}
          disabled={busy}
          bind:value={preferenceNote}
          rows={2}
          placeholder={placeholderOf("Note")}
        />
      {/snippet}
    </LabelledField>
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Recorded"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}
</ActionDialog>
