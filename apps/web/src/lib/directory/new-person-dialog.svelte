<script lang="ts">
  /*
   * Recording a person: every section of the record, reachable before the record exists.
   *
   * ONE SCREEN, WITH A LEFT SIDE AND A RIGHT SIDE. The record's sections stand as a rail on the
   * left, each with a count of what it holds, and the chosen section's fields beside it; the gate
   * the entry has to pass — what the firm may already hold under a similar spelling — is on the
   * right, permanently in view, with a summary of everything the record will hold, so nothing
   * behind a rail item is out of sight. Wider and shorter, so the whole thing fits a screen.
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
  import * as Tabs from "@magna-carta/design-system/tabs";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { createDirectoryPerson } from "./directory-api.ts";
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
    type PersonSectionId,
  } from "./person-draft.ts";
  import AddressSection from "./sections/address-section.svelte";
  import ContactSection from "./sections/contact-section.svelte";
  import DatesSection from "./sections/dates-section.svelte";
  import IdentifiersSection from "./sections/identifiers-section.svelte";
  import NamesSection from "./sections/names-section.svelte";
  import OrganizationsSection from "./sections/organizations-section.svelte";
  import PronounsSection from "./sections/pronouns-section.svelte";
  import SectionHeading from "./sections/section-heading.svelte";
  import {
    contactRowFromDraft,
    emptyContactDraft,
    type AddressDraft,
    type ContactDraft,
  } from "./contact-draft.ts";
  import { identifierRowFromDraft } from "./identifier-draft.ts";
  import { RECORD_PANEL_BODY_STYLE } from "./record-panel.ts";

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
  let section = $state<PersonSectionId>("names");
  let failure = $state<StatedFailure | null>(null);

  const search = directoryPickerSearch(fetch, { kinds: ["organization"] });

  const counts = $derived(personSectionCounts(draft));
  const summary = $derived(personDraftSummary(draft));
  const refusal = $derived(personDraftRefusal(draft));
  const warning = $derived(personDraftWarning(draft));
  const started = $derived(personDraftStarted(draft));
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
    section = "names";
    failure = null;
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

<ActionDialog
  bind:open
  kind="form"
  heading="New Person"
  commitLabel="Save"
  commitBusyLabel="Saving"
  commitRefusal={refusal}
  width="record"
  unsavedChanges={started}
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
         because the moment it is about is the moment somebody presses Record. -->
    {#if warning !== null}
      <Alert.Root variant="warning">
        <Alert.Title>This Person Has No Last Name</Alert.Title>
        <Alert.Description>{warning}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <!-- The record's sections as a rail; the chosen one's fields beside it.
         ONE HEIGHT, WHICHEVER SECTION IS CHOSEN (record-panel.ts): the section scrolls inside the
         panel rather than the panel resizing under the rail the reader is using. -->
    <Tabs.Root bind:value={section} orientation="vertical" class="gap-16" style={RECORD_PANEL_BODY_STYLE}>
      <Tabs.List class="mc-scrollbar shrink-0 overflow-y-auto" style="width: 11rem">
        {#each counts as entry (entry.id)}
          <Tabs.Trigger value={entry.id} class="justify-between">
            <span>{entry.label}</span>
            {#if entry.count !== null && entry.count > 0}
              <span class="text-xs text-text-subtle tabular-nums">{entry.count}</span>
            {/if}
          </Tabs.Trigger>
        {/each}
      </Tabs.List>

      <Tabs.Content value="names" class="mc-scrollbar min-w-0 flex-auto overflow-y-auto">
        <NamesSection
          bind:name={draft.name}
          otherNames={draft.otherNames}
          disabled={busy}
          onAddOtherName={(other) => (draft.otherNames = [...draft.otherNames, { ...other, id: crypto.randomUUID() }])}
          onRemoveOtherName={(other) => (draft.otherNames = draft.otherNames.filter((entry) => entry.id !== other.id))}
        />
      </Tabs.Content>

      <Tabs.Content value="contact" class="mc-scrollbar min-w-0 flex-auto overflow-y-auto">
        <ContactSection
          rows={contactRows}
          canEdit={!busy}
          onAdd={(contact) => (draft.contacts = [...draft.contacts, { ...contact, id: crypto.randomUUID() }])}
          onEdit={(row) => draftFor(row.id)}
          onChange={(row, contact) => replaceDraft(row.id, contact)}
          onRemove={(row) => (draft.contacts = draft.contacts.filter((entry) => entry.id !== row.id))}
        />
      </Tabs.Content>

      <!-- Beside Contact rather than a fourth kind inside it: an address is a form of six to nine
           boxes whose shape is the country's, and the record reads it back on its own section too. -->
      <Tabs.Content value="address" class="mc-scrollbar min-w-0 flex-auto overflow-y-auto">
        <AddressSection
          rows={addressRows}
          canEdit={!busy}
          onAdd={(address) => (draft.contacts = [...draft.contacts, { ...address, id: crypto.randomUUID() }])}
          onEdit={(row) => draftFor(row.id) as AddressDraft}
          onChange={(row, address) => replaceDraft(row.id, address)}
          onRemove={(row) => (draft.contacts = draft.contacts.filter((entry) => entry.id !== row.id))}
        />
      </Tabs.Content>

      <Tabs.Content value="pronouns" class="mc-scrollbar min-w-0 flex-auto overflow-y-auto">
        <PronounsSection bind:value={draft.pronouns} disabled={busy} />
      </Tabs.Content>

      <Tabs.Content value="dates" class="mc-scrollbar min-w-0 flex-auto overflow-y-auto">
        <DatesSection bind:dateOfBirth={draft.dateOfBirth} bind:dateOfDeath={draft.dateOfDeath} disabled={busy} />
      </Tabs.Content>

      <Tabs.Content value="identifiers" class="mc-scrollbar min-w-0 flex-auto overflow-y-auto">
        <IdentifiersSection
          rows={identifierRows}
          kind="person"
          canEdit={!busy}
          onAdd={(identifier) => (draft.identifiers = [...draft.identifiers, { ...identifier, id: crypto.randomUUID() }])}
          onRemove={(row) => (draft.identifiers = draft.identifiers.filter((entry) => entry.id !== row.id))}
        />
      </Tabs.Content>

      <Tabs.Content value="organizations" class="mc-scrollbar min-w-0 flex-auto overflow-y-auto">
        <OrganizationsSection
          rows={draft.organizations}
          {search}
          disabled={busy}
          onAdd={(organization) => (draft.organizations = [...draft.organizations, { ...organization, id: crypto.randomUUID() }])}
          onRemove={(organization) => (draft.organizations = draft.organizations.filter((entry) => entry.id !== organization.id))}
        />
      </Tabs.Content>
    </Tabs.Root>
  {/snippet}

  {#snippet context()}
    <!-- The same height as the sections beside it, for the same reason: a long duplicate list must
         not decide how tall the panel is either. -->
    <div class="mc-scrollbar flex flex-col gap-16 overflow-y-auto" style={RECORD_PANEL_BODY_STYLE}>
      <DuplicateGate kind="person" given={draft.name.given} family={draft.name.family} />
      {#if summary.length > 0}
        <div class="flex flex-col gap-8">
          <SectionHeading label="On This Record" />
          <dl class="grid gap-x-12 gap-y-4 text-sm" style="grid-template-columns: auto minmax(0, 1fr)">
            {#each summary as line (line.label)}
              <dt class="text-text-muted">{line.label}</dt>
              <dd class="text-right">{line.value}</dd>
            {/each}
          </dl>
        </div>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
