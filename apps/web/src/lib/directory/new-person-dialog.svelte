<script lang="ts">
  /*
   * Recording a person: every section of the record, reachable before the record exists.
   *
   * ONE SCROLLING FORM, WITH A RAIL BESIDE IT AND THE GATE ON THE RIGHT. Every section of the
   * record is stacked in one form (record-sections.svelte), so Tab walks from the name to the last
   * organization without a press in between, and the rail on the left jumps to a section and says
   * which one the reader is in, with a count of what each holds. The gate the entry has to pass —
   * what the firm may already hold under a similar spelling — is on the right, permanently in
   * view, above the record read back as it will read: the email itself, not "1 email".
   *
   * THE DRAFT IS RECORDED IN ONE BATCH. Nothing is written until the commit, and then everything
   * is written together (person-draft.ts builds the one request), so a person is never
   * half-recorded and a retry never makes a second one.
   *
   * THE PANEL IS THE ACTION DIALOG SHELL, so this file holds the rail, the sections and the commit,
   * and nothing about the panel itself: the dismissal, the busy state, Enter to commit and the
   * unsaved-work question are the shell's. The sections are the same components the record's own
   * panes use, so what is entered here reads as it will read there.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Camera from "@lucide/svelte/icons/camera";
  import { personInitials } from "@magna-carta/design-system/formatters";
  import { toast } from "@magna-carta/design-system/toast";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { createDirectoryPerson, setDirectoryEntityPhoto } from "./directory-api.ts";
  import PhotoCropDialog from "./photo-crop-dialog.svelte";
  import { directoryPickerSearch } from "./directory-picker-source.ts";
  import DuplicateGate from "./duplicate-gate.svelte";
  import {
    emptyPersonDraft,
    personCreateRequest,
    personDraftDisplayName,
    personDraftRefusal,
    personDraftStarted,
    personDraftSummary,
    personDraftWarning,
    personSectionCounts,
    type PersonDraft,
  } from "./person-draft.ts";
  import AddressSection from "./sections/address-section.svelte";
  import ContactSection from "./sections/contact-section.svelte";
  import DatesSection from "./sections/dates-section.svelte";
  import IdentifiersSection from "./sections/identifiers-section.svelte";
  import NamesSection from "./sections/names-section.svelte";
  import OrganizationsSection from "./sections/organizations-section.svelte";
  import PronounsSection from "./sections/pronouns-section.svelte";
  import NewPersonContext from "./new-person-context.svelte";
  import {
    contactRowFromDraft,
    emptyContactDraft,
    type AddressDraft,
    type ContactDraft,
  } from "./contact-draft.ts";
  import { identifierRowFromDraft } from "./identifier-draft.ts";
  import { RECORD_PANEL_BODY_STYLE } from "./record-panel.ts";
  import RecordSections from "./record-sections.svelte";

  let {
    open = $bindable(false),
    prefill = null,
    onCreated,
  }: {
    open?: boolean;
    /**
     * A name already typed somewhere else — a picker that could not find it — seeding the name
     * fields so it is not typed twice. Read at every opening; every part stays editable.
     */
    prefill?: { given: string; family: string } | null;
    /** The record's handle, and the name as this window recorded it (for a field that must show one). */
    onCreated: (entityId: string, recordedName: string) => void;
  } = $props();

  let draft = $state<PersonDraft>(emptyPersonDraft());
  let failure = $state<StatedFailure | null>(null);
  /** The photo cut for the new person, held until the person exists to hang it on. */
  let photoBase64 = $state<string | null>(null);
  let cropping = $state(false);

  const search = directoryPickerSearch(fetch, { kinds: ["organization"] });

  const counts = $derived(personSectionCounts(draft));
  const summary = $derived(personDraftSummary(draft));
  const refusal = $derived(personDraftRefusal(draft));
  const warning = $derived(personDraftWarning(draft));
  const started = $derived(personDraftStarted(draft));
  /** The name as typed so far, which heads the panel the way a record's name heads its window. */
  const typedName = $derived(personDraftDisplayName(draft).trim());
  const contactRows = $derived(
    draft.contacts
      .filter((contact) => contact.kind !== "address")
      .map((contact) => contactRowFromDraft(contact, contact.id)),
  );
  const addressRows = $derived(
    draft.contacts
      .filter((contact) => contact.kind === "address")
      .map((contact) => contactRowFromDraft(contact, contact.id)),
  );
  const identifierRows = $derived(
    draft.identifiers.map((identifier) => identifierRowFromDraft(identifier, identifier.id)),
  );

  function reset(): void {
    const empty = emptyPersonDraft();
    draft =
      prefill === null
        ? empty
        : { ...empty, name: { ...empty.name, given: prefill.given, family: prefill.family } };
    failure = null;
    photoBase64 = null;
  }

  /*
   * A drafted contact point, back as the draft its own fields edit, and the write that replaces it.
   *
   * Correcting a drafted value in this panel is the same gesture as correcting a recorded one on
   * the record, and it must be: a person who mistypes an address here would otherwise have to
   * remove the line and enter the whole address again, before the record even exists.
   */
  function draftFor(id: string): ContactDraft {
    const held = draft.contacts.find((contact) => contact.id === id);
    return held ?? emptyContactDraft("email");
  }

  function replaceDraft(id: string, next: ContactDraft): void {
    draft.contacts = draft.contacts.map((contact) =>
      contact.id === id ? { ...next, id } : contact,
    );
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    // A retried submit must not make a second record, so every attempt carries its own key and the
    // server answers the repeat with the first result.
    const outcome = await createDirectoryPerson(fetch, personCreateRequest(draft), crypto.randomUUID());
    if (outcome.kind === "ok") {
      // The person is recorded whether or not the photo lands after it; a photo that did not is
      // said so, and is added again from the record.
      if (photoBase64 !== null) {
        const photo = await setDirectoryEntityPhoto(
          fetch,
          outcome.value.id,
          photoBase64,
          crypto.randomUUID(),
        );
        if (photo.kind !== "ok") {
          toast.error("The person was saved, but the photo was not. Add it from their record.");
        }
      }
      onCreated(outcome.value.id, personDraftDisplayName(draft));
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The person could not be recorded.",
      "Nothing was recorded, so nothing was half-recorded.",
    );
    return "refused";
  }
</script>

<!-- The photo stands at the top left, where the record window puts it, so the person being entered
     reads as the record they will become. Pressing it adds or changes the picture. -->
{#snippet newPersonPhoto()}
  <span class="relative shrink-0">
    <button
      type="button"
      class="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-focus-ring"
      aria-label={photoBase64 === null ? "Add a photo of the new person" : "Edit the new person's photo"}
      title={photoBase64 === null ? "Add Photo" : "Edit Photo"}
      onclick={() => (cropping = true)}
    >
      <Avatar.Root class="size-48 shrink-0">
        {#if photoBase64 !== null}
          <Avatar.Image src={`data:image/jpeg;base64,${photoBase64}`} alt="The new person's photo" />
        {/if}
        <Avatar.Fallback>{personInitials(typedName)}</Avatar.Fallback>
      </Avatar.Root>
    </button>
    {#if photoBase64 === null}
      <span
        class="pointer-events-none absolute -end-4 -bottom-4 flex size-20 items-center justify-center rounded-full border border-border-default bg-surface-raised"
        aria-hidden="true"
      >
        <Camera class="size-12" />
      </span>
    {/if}
  </span>
{/snippet}

<ActionDialog
  bind:open
  kind="form"
  heading={typedName === "" ? "New Person" : typedName}
  subtitle={typedName === "" ? undefined : { facts: ["New Person"] }}
  leading={newPersonPhoto}
  commitLabel="Save"
  commitBusyLabel="Saving"
  commitRefusal={refusal}
  width="record"
  unsavedChanges={started || photoBase64 !== null}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Person Was Not Recorded"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
    <!-- A WARNING, WHICH IS NOT A REFUSAL: the commit stays live and records exactly what is on
         screen. It stands in the band directly above the commit rather than beside the name field,
         because the moment it is about is the moment somebody presses Save. -->
    {#if warning !== null}
      <Alert.Root variant="warning">
        <Alert.Title>This Person Has No Last Name</Alert.Title>
        <Alert.Description>{warning}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <!-- Every section in one form; the rail beside it jumps between them. -->
    <RecordSections sections={counts} label="Sections of the new person">
      {#snippet section(part)}
        {#if part.id === "names"}
          <NamesSection
            bind:name={draft.name}
            bind:otherNames={draft.otherNames}
          />
        {:else if part.id === "contact"}
          <ContactSection
            rows={contactRows}
            canEdit={!busy}
            onAdd={(contact) => (draft.contacts = [...draft.contacts, { ...contact, id: crypto.randomUUID() }])}
            onEdit={(row) => draftFor(row.id)}
            onChange={(row, contact) => replaceDraft(row.id, contact)}
            onRemove={(row) => (draft.contacts = draft.contacts.filter((entry) => entry.id !== row.id))}
          />
        {:else if part.id === "address"}
          <!-- Beside Contact rather than a fourth kind inside it: an address is a form of six to
               nine boxes whose shape is the country's, and the record reads it back on its own
               section too. -->
          <AddressSection
            rows={addressRows}
            canEdit={!busy}
            onAdd={(address) => (draft.contacts = [...draft.contacts, { ...address, id: crypto.randomUUID() }])}
            onEdit={(row) => draftFor(row.id) as AddressDraft}
            onChange={(row, address) => replaceDraft(row.id, address)}
            onRemove={(row) => (draft.contacts = draft.contacts.filter((entry) => entry.id !== row.id))}
          />
        {:else if part.id === "about"}
          <div class="flex flex-col gap-16">
            <PronounsSection bind:value={draft.pronouns} disabled={busy} />
            <DatesSection bind:dateOfBirth={draft.dateOfBirth} bind:dateOfDeath={draft.dateOfDeath} disabled={busy} />
          </div>
        {:else if part.id === "identifiers"}
          <IdentifiersSection
            rows={identifierRows}
            kind="person"
            canEdit={!busy}
            onAdd={(identifier) => (draft.identifiers = [...draft.identifiers, { ...identifier, id: crypto.randomUUID() }])}
            onRemove={(row) => (draft.identifiers = draft.identifiers.filter((entry) => entry.id !== row.id))}
          />
        {:else if part.id === "organizations"}
          <OrganizationsSection
            rows={draft.organizations}
            {search}
            disabled={busy}
            onAdd={(organization) => (draft.organizations = [...draft.organizations, { ...organization, id: crypto.randomUUID() }])}
            onRemove={(organization) => (draft.organizations = draft.organizations.filter((entry) => entry.id !== organization.id))}
          />
        {/if}
      {/snippet}
    </RecordSections>
  {/snippet}

  {#snippet context()}
    <!-- The same height as the sections beside it, for the same reason: a long duplicate list must
         not decide how tall the panel is either. -->
    <div class="mc-scrollbar flex flex-col overflow-y-auto" style={RECORD_PANEL_BODY_STYLE}>
      <NewPersonContext
        {summary}
        name={personDraftDisplayName(draft)}
        {photoBase64}
      >
        {#snippet gate()}
          <DuplicateGate kind="person" given={draft.name.given} family={draft.name.family} />
        {/snippet}
      </NewPersonContext>
    </div>
  {/snippet}
</ActionDialog>

<PhotoCropDialog
  bind:open={cropping}
  heading={photoBase64 === null ? "Add Photo" : "Edit Photo"}
  subject={personDraftDisplayName(draft) || "New Person"}
  current={photoBase64 === null ? null : `data:image/jpeg;base64,${photoBase64}`}
  onRemove={async () => {
    photoBase64 = null;
    return true;
  }}
  onSave={async (imageBase64) => {
    photoBase64 = imageBase64;
    return null;
  }}
/>
