<script lang="ts">
  /*
   * One office — opened, entered, corrected. ONE WINDOW FOR ALL THREE, on the call log's precedent:
   * a record is MADE in the same window it is read in, and the only difference between the two
   * states is whether the window opened with a record in it.
   *
   * WHAT THE LEFT PANE HOLDS is the office itself: its name, where it is, its zone and its code, the
   * way to write to it, and the addresses with the telephone each answers on. Editing segments the
   * entry into three tabs — the office, its addresses, its letterhead text — because an office is
   * three kinds of fact and one long column of them scrolls past the gate (the standing rule for a
   * creation screen: the entry on the left, segmented where it needs segmenting).
   *
   * WHAT THE RIGHT PANE HOLDS is context and the acts that commit on their own: who staffs the
   * office, and the mark its letterhead prints. Each is its own write against its own route, which
   * is why they sit in tabs rather than in the fields — the shell keeps its tabs reachable in both
   * modes precisely so an act that does not ride the save can be reached while the save is being
   * written. A member or a logo chosen BEFORE the office exists is held and written the moment the
   * office is: making somebody save, find the office again and reopen it is the same work twice.
   *
   * THE ADDRESS IS THE PRODUCT'S ONE ADDRESS FORM. Its shape is the country's: the country leads
   * and decides which boxes follow, and changing it never moves a value between fields. The
   * telephone beside each address is the product's one number field, which groups the digits the
   * way the chosen country writes them.
   *
   * CLOSING IS AN ACT, NOT A FIELD. An office closes through the action bar and asks first; the
   * firm's default office refuses to close until another office has taken that role, and the way
   * to give it that role is on the same bar.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import { administrativeAreasFor } from "@magna-carta/address-formats/administrative-areas";
  import { postalCodeNoteFor } from "@magna-carta/address-formats/postal-code";
  import AddressFields from "@magna-carta/design-system/address-fields";
  import { addressLookup } from "$lib/addresses/address-lookup-source.ts";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import FileInput from "@magna-carta/design-system/file-input";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatInstant, formatNumber } from "@magna-carta/design-system/formatters";
  import Star from "@lucide/svelte/icons/star";
  import Unlink from "@lucide/svelte/icons/unlink";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import TimeZonePicker from "$lib/calendar/time-zone-picker.svelte";
  import { timeZoneLabel } from "$lib/calendar/time-zone-options.ts";
  import { viewerTimeZone } from "$lib/dates";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import PhoneNumberField from "$lib/directory/phone-number-field.svelte";
  import { formatStoredPhone, phoneCountries } from "$lib/directory/phone-entry.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import MemberPicker from "$lib/matters/member-picker.svelte";
  import { firmOffices } from "./firm-offices.svelte.ts";
  import {
    emptyOfficeDraft,
    officeAddressesRequest,
    officeDraftFrom,
    officeDraftsEqual,
    officeDraftShortfalls,
    officeFieldsRequest,
    type OfficeDraft,
  } from "./office-draft.ts";
  import { officeSheet } from "./office-print-sheet.ts";
  import {
    OFFICE_ADDRESS_KINDS,
    officeAddressLine,
    officeAddressOfKind,
    officeCitation,
    officeStatusKey,
  } from "./office-vocabulary.ts";
  import {
    addOfficeMember,
    clearOfficeLetterheadLogo,
    closeOffice,
    createOffice,
    fileToBase64,
    officeLetterheadLogoHref,
    readOffice,
    removeOfficeMember,
    setFirmDefaultOffice,
    setOfficeAddresses,
    setOfficeLetterheadLogo,
    updateOffice,
    type OfficeDetail,
  } from "./offices-api.ts";

  let {
    open = $bindable(false),
    officeId,
    canManage = false,
    onChanged,
  }: {
    open?: boolean;
    /** The office being read, or NULL to enter a new one. */
    officeId: string | null;
    /** Whether this account may change the firm's offices. */
    canManage?: boolean;
    /** The register changed under this window; the surface that opened it re-reads. */
    onChanged: () => void;
  } = $props();

  /** How wide a letterhead mark prints unless the firm says otherwise: a two-and-a-half-inch mark. */
  const DEFAULT_PRINTED_WIDTH_POINTS = 180;

  const creating = $derived(officeId === null);

  let record = $state<OfficeDetail | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let editing = $state(false);
  let saving = $state(false);
  let saveFailure = $state<StatedFailure | null>(null);
  let draft = $state<OfficeDraft>(emptyOfficeDraft());
  let since = $state<OfficeDraft>(emptyOfficeDraft());
  let section = $state("office");
  let printOpen = $state(false);
  /** Bumped after a logo write, so the image element re-reads a path that does not move. */
  let logoVersion = $state<string | null>(null);

  // Real addresses offered from each street box. Dormant, and invisible, until a service is provisioned.
  const streetLookup = addressLookup();
  const countries = phoneCountries().map((country) => ({
    code: country.region,
    name: country.name,
  }));

  /** Zones offered first: the reader's own, then every other office's. */
  const preferredZones = $derived([
    viewerTimeZone(),
    ...(firmOffices.offices ?? [])
      .map((office) => office.timeZone)
      .filter((zone): zone is string => zone !== null),
  ]);

  function readRecord(): void {
    const wanted = officeId;
    if (wanted === null) return;
    record = null;
    readFailure = null;
    void (async () => {
      const outcome = await readOffice(fetch, wanted);
      if (officeId !== wanted) return;
      if (outcome.kind === "ok") {
        record = outcome.value;
        logoVersion = outcome.value.letterheadLogo?.updatedAt ?? null;
        return;
      }
      readFailure = stated(outcome.failure, "That office could not be read.");
    })();
  }

  $effect(() => {
    if (!open) return;
    saveFailure = null;
    memberProblem = null;
    logoProblem = null;
    section = "office";
    pendingMembers = [];
    pendingLogo = null;
    chosenLogoFile = null;
    void firmRoster.load(fetch);
    void firmOffices.load(fetch);
    if (officeId === null) {
      record = null;
      readFailure = null;
      editing = true;
      draft = emptyOfficeDraft();
      since = emptyOfficeDraft();
      return;
    }
    editing = false;
    readRecord();
  });

  // The draft follows the record: entering editing starts from what the record holds, and a
  // record re-read after a save replaces it, so the fields never show a value the server moved past.
  $effect(() => {
    const held = record;
    if (held !== null) {
      draft = officeDraftFrom(held);
      since = officeDraftFrom(held);
    }
  });

  const heading = $derived(creating ? "New Office" : (record?.name ?? ""));
  const shortfalls = $derived(officeDraftShortfalls(draft));

  const editRefusal = $derived.by((): string | undefined => {
    if (!canManage) return "Your account cannot change the firm's offices.";
    if (creating) return "This office has not been saved yet.";
    if (record === null) return "Reading the office.";
    return undefined;
  });

  const saveRefusal = $derived.by((): string | undefined => {
    if (!creating && record === null) return "Reading the office.";
    if (saving) return "Saving.";
    return shortfalls[0];
  });

  const changed = $derived(!officeDraftsEqual(draft, since));

  /**
   * Write the office: its fields, then its addresses, then whatever was chosen for it before it
   * existed. The fields come first because the addresses hang off the office's own id.
   */
  async function save(): Promise<void> {
    if (saveRefusal !== undefined) return;
    saving = true;
    saveFailure = null;
    const fields = officeFieldsRequest(draft);
    const addresses = officeAddressesRequest(draft);
    let id = officeId;
    if (id === null) {
      const created = await createOffice(fetch, fields, crypto.randomUUID());
      if (created.kind !== "ok") {
        saving = false;
        saveFailure = stated(
          created.failure,
          "The office was not saved.",
          "Couldn't connect. Nothing was saved.",
        );
        return;
      }
      id = created.value.id;
    } else {
      const updated = await updateOffice(fetch, id, fields, crypto.randomUUID());
      if (updated.kind !== "ok") {
        saving = false;
        saveFailure = stated(
          updated.failure,
          "The change was not saved.",
          "Couldn't connect. Nothing changed.",
        );
        return;
      }
    }
    const setAddresses = await setOfficeAddresses(fetch, id, addresses, crypto.randomUUID());
    if (setAddresses.kind !== "ok") {
      saving = false;
      saveFailure = stated(
        setAddresses.failure,
        creating
          ? "The office was saved, but its addresses were not."
          : "The office's details were saved, but its addresses weren't.",
      );
      return;
    }
    // What was chosen for an office before it existed, written now that it does.
    for (const pending of pendingMembers) {
      await addOfficeMember(fetch, id, pending.userId, pending.isPrimary, crypto.randomUUID());
    }
    if (pendingLogo !== null) {
      await setOfficeLetterheadLogo(
        fetch,
        id,
        await fileToBase64(pendingLogo.file),
        pendingLogo.printedWidthPoints,
        crypto.randomUUID(),
      );
    }
    saving = false;
    void firmOffices.reload(fetch);
    onChanged();
    if (creating) {
      // The window closes on an office it has just made: the register behind it now carries it.
      open = false;
      return;
    }
    editing = false;
    readRecord();
  }

  function forgetChanges(): void {
    saveFailure = null;
    if (creating) {
      open = false;
      return;
    }
    if (record !== null) draft = officeDraftFrom(record);
  }

  // ---- members: acts against their own route, held until the office exists ----------------------

  let pendingMembers = $state<{ userId: string; isPrimary: boolean }[]>([]);
  let memberPick = $state<string | null>(null);
  let memberPrimary = $state(false);
  let memberBusy = $state<string | null>(null);
  let memberProblem = $state<StatedFailure | null>(null);

  const memberRefusal = $derived.by((): string | undefined => {
    if (!canManage) return "Your account cannot change who staffs the firm's offices.";
    if (memberPick === null) return "Choose a member.";
    return undefined;
  });

  /** Who is at the office, as the window shows them: the record's members, or the held picks. */
  const shownMembers = $derived.by(() => {
    if (!creating) return record?.members ?? [];
    return pendingMembers.map((pending) => {
      const member = (firmRoster.members ?? []).find(
        (candidate) => candidate.userId === pending.userId,
      );
      return {
        userId: pending.userId,
        displayName: member?.displayName ?? pending.userId,
        status: member?.status ?? "active",
        isPrimary: pending.isPrimary,
      };
    });
  });

  async function addMember(): Promise<void> {
    const userId = memberPick;
    if (userId === null || memberRefusal !== undefined) return;
    if (creating) {
      pendingMembers = [
        ...pendingMembers.filter((pending) => pending.userId !== userId),
        { userId, isPrimary: memberPrimary },
      ];
      memberPick = null;
      memberPrimary = false;
      return;
    }
    const id = officeId;
    if (id === null) return;
    memberBusy = userId;
    memberProblem = null;
    const outcome = await addOfficeMember(fetch, id, userId, memberPrimary, crypto.randomUUID());
    memberBusy = null;
    if (outcome.kind !== "ok") {
      memberProblem = stated(outcome.failure, "The member was not added to the office.");
      return;
    }
    memberPick = null;
    memberPrimary = false;
    readRecord();
    onChanged();
  }

  async function makeMemberPrimary(userId: string): Promise<void> {
    if (creating) {
      pendingMembers = pendingMembers.map((pending) => ({
        ...pending,
        isPrimary: pending.userId === userId,
      }));
      return;
    }
    const id = officeId;
    if (id === null) return;
    memberBusy = userId;
    memberProblem = null;
    const outcome = await addOfficeMember(fetch, id, userId, true, crypto.randomUUID());
    memberBusy = null;
    if (outcome.kind !== "ok") {
      memberProblem = stated(outcome.failure, "The member's primary office was not changed.");
      return;
    }
    readRecord();
    onChanged();
  }

  async function removeMember(userId: string): Promise<void> {
    if (creating) {
      pendingMembers = pendingMembers.filter((pending) => pending.userId !== userId);
      return;
    }
    const id = officeId;
    if (id === null) return;
    memberBusy = userId;
    memberProblem = null;
    const outcome = await removeOfficeMember(fetch, id, userId, crypto.randomUUID());
    memberBusy = null;
    if (outcome.kind !== "ok") {
      memberProblem = stated(outcome.failure, "The member was not taken off the office.");
      return;
    }
    readRecord();
    onChanged();
  }

  // ---- the letterhead logo: its own write, held until the office exists ------------------------

  let chosenLogoFile = $state<File | null>(null);
  let printedWidthText = $state(String(DEFAULT_PRINTED_WIDTH_POINTS));
  let pendingLogo = $state<{ file: File; printedWidthPoints: number } | null>(null);
  let logoBusy = $state(false);
  let logoProblem = $state<StatedFailure | null>(null);

  const printedWidthPoints = $derived.by((): number | null => {
    const parsed = Number(printedWidthText.trim());
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 720 ? parsed : null;
  });

  const logoRefusal = $derived.by((): string | undefined => {
    if (!canManage) return "Your account cannot change the firm's offices.";
    if (chosenLogoFile === null) return "Choose a PNG or a JPEG.";
    if (printedWidthPoints === null) return "The printed width is a number of points, up to 720.";
    return undefined;
  });

  function chooseLogoFile(files: FileList | null): void {
    chosenLogoFile = files?.[0] ?? null;
  }

  async function setLogo(): Promise<void> {
    if (logoRefusal !== undefined || chosenLogoFile === null || printedWidthPoints === null) return;
    if (creating) {
      pendingLogo = { file: chosenLogoFile, printedWidthPoints };
      return;
    }
    const id = officeId;
    if (id === null) return;
    logoBusy = true;
    logoProblem = null;
    const outcome = await setOfficeLetterheadLogo(
      fetch,
      id,
      await fileToBase64(chosenLogoFile),
      printedWidthPoints,
      crypto.randomUUID(),
    );
    logoBusy = false;
    if (outcome.kind !== "ok") {
      logoProblem = stated(outcome.failure, "The logo was not set.");
      return;
    }
    chosenLogoFile = null;
    readRecord();
    onChanged();
  }

  async function clearLogo(): Promise<void> {
    if (creating) {
      pendingLogo = null;
      return;
    }
    const id = officeId;
    if (id === null) return;
    logoBusy = true;
    logoProblem = null;
    const outcome = await clearOfficeLetterheadLogo(fetch, id, crypto.randomUUID());
    logoBusy = false;
    if (outcome.kind !== "ok") {
      logoProblem = stated(outcome.failure, "The logo was not removed.");
      return;
    }
    readRecord();
    onChanged();
  }

  // ---- the acts on the bar ----------------------------------------------------------------------

  let closeOpen = $state(false);
  let closeFailure = $state<StatedFailure | null>(null);
  let defaultBusy = $state(false);
  let defaultProblem = $state<StatedFailure | null>(null);

  const closeRefusal = $derived.by((): string | undefined => {
    if (!canManage) return "Your account cannot close an office.";
    if (record === null) return "Reading the office.";
    if (record.status === "closed") return "This office is already closed.";
    if (record.firmDefault) {
      return "The firm's default office cannot be closed. Make another office the default first.";
    }
    return undefined;
  });

  const defaultRefusal = $derived.by((): string | undefined => {
    if (!canManage) return "Your account cannot change the firm's default office.";
    if (record === null) return "Reading the office.";
    if (record.firmDefault) return "This is already the firm's default office.";
    if (record.status === "closed") return "A closed office cannot be the firm's default.";
    return undefined;
  });

  async function commitClose(): Promise<ActionOutcome> {
    const id = officeId;
    if (id === null) return "refused";
    closeFailure = null;
    const outcome = await closeOffice(fetch, id, crypto.randomUUID());
    if (outcome.kind !== "ok") {
      closeFailure = stated(outcome.failure, "The office was not closed.");
      return "refused";
    }
    void firmOffices.reload(fetch);
    readRecord();
    onChanged();
    return "committed";
  }

  async function makeDefault(): Promise<void> {
    const id = officeId;
    if (id === null || defaultRefusal !== undefined) return;
    defaultBusy = true;
    defaultProblem = null;
    const outcome = await setFirmDefaultOffice(fetch, id, crypto.randomUUID());
    defaultBusy = false;
    if (outcome.kind !== "ok") {
      defaultProblem = stated(outcome.failure, "The firm's default office was not changed.");
      return;
    }
    void firmOffices.reload(fetch);
    readRecord();
    onChanged();
  }

  const sheet = $derived(
    record === null
      ? null
      : officeSheet(record, {
          firmName: sessionPermissions.session?.firm?.name ?? null,
          printedAt: formatInstant(new Date()),
        }),
  );

  const logoFacts = $derived.by(() => {
    const logo = record?.letterheadLogo;
    if (logo == null) {
      return [
        { label: "Image", value: "" },
        { label: "Prints At", value: "" },
      ];
    }
    return [
      { label: "Image", value: `${formatNumber(logo.widthPixels)} by ${formatNumber(logo.heightPixels)} pixels, ${logo.contentType === "image/png" ? "PNG" : "JPEG"}` },
      { label: "Prints At", value: `${formatNumber(logo.printedWidthPoints)} points wide` },
      ...(logo.updatedAt === null ? [] : [{ label: "Set", value: formatInstant(logo.updatedAt) }]),
    ];
  });

  const membersTab = $derived<RecordWindowTab>({
    key: "members",
    label: "Members",
    count: shownMembers.length,
    content: membersTabContent,
  });
</script>

{#snippet subtitle()}
  {#if creating}
    A new office.
  {:else if record !== null}
    {#if officeCitation(record) !== ""}
      {officeCitation(record)} &middot;
    {/if}
    {statusEntry(officeStatusKey(record.status)).label}
    {#if record.firmDefault}
      &middot; Firm default
    {/if}
  {/if}
{/snippet}

{#snippet fact(label: string, value: string)}
  <!-- Every term stands, with the dash where nothing is recorded: the frame is the same whether an
       office has filled it in or not, so a reader learns where each fact will be. -->
  <DefinitionList.Row term={label} empty={value === ""}>{value}</DefinitionList.Row>
{/snippet}

{#snippet addressFields(which: "physical" | "mailing", identity: string)}
  <AddressFields
    bind:value={draft[which].parts}
    {countries}
    administrativeAreas={administrativeAreasFor(draft[which].parts.country)}
    postalCodeNote={postalCodeNoteFor}
    lookup={streetLookup}
    disabled={saving}
  />
  <PhoneNumberField
    bind:region={draft[which].phoneRegion}
    bind:number={draft[which].phoneNumber}
    bind:extension={draft[which].phoneExtension}
    label="Telephone"
    countryInputId="{identity}-phone-country"
    numberInputId="{identity}-phone-number"
    extensionInputId="{identity}-phone-extension"
    disabled={saving}
  />
{/snippet}

{#snippet recordPane({ editing: inEdit }: { editing: boolean })}
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
        title={creating ? "Nothing Was Saved" : "Nothing Was Changed"}
        fallback={saveFailure.fallback}
        whenSilent={saveFailure.whenSilent}
      />
    {/if}
    {#if defaultProblem !== null}
      <FailureNotice failure={defaultProblem.failure} fallback={defaultProblem.fallback} />
    {/if}

    {#if inEdit}
      <Tabs.Root bind:value={section} class="flex flex-col gap-16">
        <Tabs.List>
          <Tabs.Trigger value="office">Office</Tabs.Trigger>
          <Tabs.Trigger value="addresses">Addresses</Tabs.Trigger>
          <Tabs.Trigger value="letterhead">Letterhead</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="office" class="flex flex-col gap-12">
          <LabelledField label="Name">
            {#snippet children({ props })}
              <Input {...props} bind:value={draft.name} disabled={saving} />
            {/snippet}
          </LabelledField>
          <div class="grid gap-12 sm:grid-cols-2">
            <LabelledField label="Jurisdiction" hint="The jurisdiction whose trust rules the office keeps, as the firm names it.">
              {#snippet children({ props })}
                <Input {...props} bind:value={draft.jurisdiction} disabled={saving} />
              {/snippet}
            </LabelledField>
            <LabelledField label="Numbering Code" hint="The short code a location segment of the firm's matter numbers prints.">
              {#snippet children({ props })}
                <Input {...props} bind:value={draft.numberCode} disabled={saving} />
              {/snippet}
            </LabelledField>
          </div>
          <LabelledField label="Time Zone" id="office-time-zone">
            {#snippet children({ props })}
              <TimeZonePicker
                bind:value={draft.timeZone}
                inputId={props.id}
                label="Time Zone"
                preferred={preferredZones}
                disabled={saving}
              />
            {/snippet}
          </LabelledField>
          <LabelledField label="Email">
            {#snippet children({ props })}
              <Input {...props} type="email" bind:value={draft.email} disabled={saving} />
            {/snippet}
          </LabelledField>
        </Tabs.Content>

        <Tabs.Content value="addresses" class="flex flex-col gap-16">
          <div class="flex flex-col gap-12">
            <FieldLabel as="h3">Street Address</FieldLabel>
            {@render addressFields("physical", "office-physical")}
          </div>
          <div class="flex items-center gap-8">
            <Checkbox
              id="office-separate-mailing"
              bind:checked={draft.separateMailingAddress}
              disabled={saving}
            />
            <Label for="office-separate-mailing">Post goes to a different address</Label>
          </div>
          {#if draft.separateMailingAddress}
            <div class="flex flex-col gap-12">
              <FieldLabel as="h3">Mailing Address</FieldLabel>
              {@render addressFields("mailing", "office-mailing")}
            </div>
          {/if}
        </Tabs.Content>

        <Tabs.Content value="letterhead" class="flex flex-col gap-12">
          <LabelledField label="Address Block" hint="The lines a letterhead prints under the mark, as they should read.">
            {#snippet children({ props })}
              <Textarea {...props} rows={3} resizable={false} bind:value={draft.addressBlock} disabled={saving} />
            {/snippet}
          </LabelledField>
          <LabelledField label="Footer">
            {#snippet children({ props })}
              <Textarea {...props} rows={2} resizable={false} bind:value={draft.footer} disabled={saving} />
            {/snippet}
          </LabelledField>
          <LabelledField label="Remit To" hint="Where a bill on this office's matters says to send payment.">
            {#snippet children({ props })}
              <Textarea {...props} rows={2} resizable={false} bind:value={draft.remitTo} disabled={saving} />
            {/snippet}
          </LabelledField>
        </Tabs.Content>
      </Tabs.Root>
    {:else if record !== null}
      <div class="flex flex-wrap items-center gap-8">
        <Badge {...statusBadgeAttributes(officeStatusKey(record.status))}>
          {statusEntry(officeStatusKey(record.status)).label}
        </Badge>
        {#if record.firmDefault}
          <Badge variant="accent">Firm default</Badge>
        {/if}
      </div>

      <DefinitionList.Root class="text-sm">
        {@render fact("Jurisdiction", record.jurisdiction ?? "")}
        {@render fact("Time Zone", record.timeZone === null ? "" : timeZoneLabel(record.timeZone))}
        {@render fact("Numbering Code", record.numberCode ?? "")}
        {@render fact("Email", record.email ?? "")}
      </DefinitionList.Root>

      <!-- Both addresses stand whether or not the office has them: the same frames on every office,
           with the words about an absent one inside its frame. -->
      {#each OFFICE_ADDRESS_KINDS as kind (kind.value)}
        {@const address = officeAddressOfKind(record, kind.value)}
        <div class="flex flex-col gap-4">
          <FieldLabel as="h3">{kind.label}</FieldLabel>
          <DefinitionList.Root class="text-sm">
            {@render fact("Address", officeAddressLine(address))}
            {@render fact(
              "Telephone",
              address?.phone == null
                ? ""
                : formatStoredPhone({
                    number: address.phone,
                    countryRegionCode: address.country,
                    extension: null,
                  }),
            )}
            {#if address === undefined && kind.value === "mailing"}
              <DefinitionList.Empty>Post goes to the street address.</DefinitionList.Empty>
            {:else if address === undefined}
              <DefinitionList.Empty>No street address is recorded.</DefinitionList.Empty>
            {/if}
          </DefinitionList.Root>
        </div>
      {/each}

      <div class="flex flex-col gap-4">
        <FieldLabel as="h3">Letterhead</FieldLabel>
        <DefinitionList.Root class="text-sm">
          {@render fact("Address Block", record.addressBlock ?? "")}
          {@render fact("Footer", record.footer ?? "")}
          {@render fact("Remit To", record.remitTo ?? "")}
        </DefinitionList.Root>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet membersTabContent()}
  <div class="flex flex-col gap-12">
    {#if memberProblem !== null}
      <FailureNotice failure={memberProblem.failure} fallback={memberProblem.fallback} />
    {/if}
    {#if shownMembers.length > 0}
      <ul class="flex flex-col">
        {#each shownMembers as member (member.userId)}
          <li class="flex items-center gap-8 border-b border-border-default py-4">
            <span class="min-w-0 flex-auto">{member.displayName}</span>
            {#if member.status === "deactivated"}
              <Badge {...statusBadgeAttributes("member-no-access")}>
                {statusEntry("member-no-access").label}
              </Badge>
            {/if}
            {#if member.isPrimary}
              <Badge variant="accent">Primary</Badge>
            {:else if canManage}
              <Button
                variant="ghost"
                size="icon"
                disabled={memberBusy === member.userId}
                title="Make this their primary office"
                aria-label="Make this {member.displayName}'s primary office"
                onclick={() => void makeMemberPrimary(member.userId)}
              >
                <Star class="size-16" aria-hidden="true" />
              </Button>
            {/if}
            {#if canManage}
              <Button
                variant="ghost"
                size="icon"
                disabled={memberBusy === member.userId}
                title="Take them off this office"
                aria-label="Take {member.displayName} off this office"
                onclick={() => void removeMember(member.userId)}
              >
                <Unlink class="size-16" aria-hidden="true" />
              </Button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if canManage}
      <!-- The entry row: the last row of the list, under the same rule as every other row. -->
      <div class="flex flex-col gap-8">
        <LabelledField label="Member" id="office-member-pick">
          {#snippet children({ props })}
            <MemberPicker
              members={firmRoster.members ?? []}
              bind:value={memberPick}
              inputId={props.id}
              label="Member"
              exclude={shownMembers.map((member) => member.userId)}
            />
          {/snippet}
        </LabelledField>
        {#if firmRoster.failure !== null}
          <p class="text-xs text-text-muted">{firmRoster.failure}</p>
        {/if}
        <div class="flex items-center justify-between gap-8">
          <span class="flex items-center gap-8">
            <Checkbox id="office-member-primary" bind:checked={memberPrimary} />
            <Label for="office-member-primary">Their primary office</Label>
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={memberRefusal !== undefined || memberBusy !== null}
            title={memberRefusal}
            onclick={() => void addMember()}
          >
            Add Member
          </Button>
        </div>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet letterheadTabContent()}
  <div class="flex flex-col gap-12">
    {#if logoProblem !== null}
      <FailureNotice failure={logoProblem.failure} fallback={logoProblem.fallback} />
    {/if}
    {#if !creating && record !== null && officeId !== null && record.letterheadSource !== "none"}
      <img
        src={officeLetterheadLogoHref(officeId, logoVersion)}
        alt="The mark {record.name}'s letterhead prints"
        class="max-h-96 self-start object-contain"
      />
    {/if}
    <!-- The facts about the mark stand whether or not there is one: the same frame on every
         office, with the words about an absent mark inside it. -->
    <DefinitionList.Root class="text-sm">
      {#if creating}
        {@render fact("Chosen", pendingLogo?.file.name ?? "")}
        {@render fact(
          "Prints At",
          pendingLogo === null ? "" : `${formatNumber(pendingLogo.printedWidthPoints)} points wide`,
        )}
        {#if pendingLogo === null}
          <DefinitionList.Empty>
            No logo chosen. The office uses the firm's logo until it has its own.
          </DefinitionList.Empty>
        {:else}
          <DefinitionList.Empty>Set when the office is saved.</DefinitionList.Empty>
        {/if}
      {:else if record?.letterheadSource === "firm"}
        {@render fact("Mark", "The firm's primary mark")}
        <DefinitionList.Empty>
          This office has no logo, so its letterhead uses the firm's.
        </DefinitionList.Empty>
      {:else}
        {#each logoFacts as entry (entry.label)}
          {@render fact(entry.label, entry.value)}
        {/each}
        {#if record !== null && record.letterheadSource === "none"}
          <DefinitionList.Empty>
            This office's letterhead has no logo: neither the office nor the firm has set one.
          </DefinitionList.Empty>
        {/if}
      {/if}
    </DefinitionList.Root>
    {#if canManage}
      <LabelledField label="Logo" hint="A PNG or JPEG. Its height is set by its proportions.">
        {#snippet children({ props })}
          <FileInput
            {...props}
            accept="image/png,image/jpeg"
            disabled={logoBusy}
            onchange={(event) => chooseLogoFile(event.currentTarget.files)}
          />
        {/snippet}
      </LabelledField>
      <LabelledField label="Printed Width (points)">
        {#snippet children({ props })}
          <Input {...props} inputmode="decimal" bind:value={printedWidthText} disabled={logoBusy} class="tabular-nums" />
        {/snippet}
      </LabelledField>
      <div class="flex items-center justify-end gap-8">
        {#if (record?.letterheadSource === "office" && !creating) || pendingLogo !== null}
          <Button variant="secondary" size="sm" disabled={logoBusy} onclick={() => void clearLogo()}>
            Remove Logo
          </Button>
        {/if}
        <Button
          variant="secondary"
          size="sm"
          disabled={logoRefusal !== undefined || logoBusy}
          title={logoRefusal}
          onclick={() => void setLogo()}
        >
          {logoBusy ? "Setting" : "Set Logo"}
        </Button>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet actions({ editing: inEdit }: { editing: boolean })}
  {#if !creating && !inEdit && record !== null}
    <Button
      variant="secondary"
      disabled={defaultRefusal !== undefined || defaultBusy}
      title={defaultRefusal}
      onclick={() => void makeDefault()}
    >
      Make Firm Default
    </Button>
    <Button
      variant="destructive"
      disabled={closeRefusal !== undefined}
      title={closeRefusal}
      onclick={() => (closeOpen = true)}
    >
      Close Office
    </Button>
  {/if}
{/snippet}

<RecordWindow
  bind:open
  bind:editing
  {heading}
  {subtitle}
  record={recordPane}
  {actions}
  tabs={[
    membersTab,
    { key: "letterhead-logo", label: "Letterhead Logo", content: letterheadTabContent },
  ] satisfies RecordWindowTab[]}
  editDisabledReason={editRefusal}
  saveDisabledReason={saveRefusal}
  unsavedChanges={creating ? changed || pendingMembers.length > 0 || pendingLogo !== null : changed}
  onSave={() => void save()}
  onCancel={forgetChanges}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}

<ActionDialog
  bind:open={closeOpen}
  kind="destructive"
  heading="Close Office"
  commitLabel="Close Office"
  commitBusyLabel="Closing"
  commitRefusal={closeRefusal}
  unsavedChanges={false}
  onCommit={commitClose}
>
  {#snippet subtitle()}{record?.name ?? ""}{/snippet}
  {#snippet notice()}
    {#if closeFailure !== null}
      <FailureNotice failure={closeFailure.failure} fallback={closeFailure.fallback} />
    {/if}
  {/snippet}
  {#snippet fields()}
    <p class="text-sm">
      A closed office is no longer offered in office lists. Its record, matters and letterhead documents are kept.
    </p>
  {/snippet}
</ActionDialog>
