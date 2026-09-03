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
  import * as Tabs from "@magna-carta/design-system/tabs";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { createDirectoryPerson } from "./directory-api.ts";
  import { directoryPickerSearch } from "./directory-picker-source.ts";
  import DuplicateGate from "./duplicate-gate.svelte";
  import {
    emptyPersonDraft,
    personCreateRequest,
    personDraftRefusal,
    personDraftStarted,
    personDraftSummary,
    personSectionCounts,
    type PersonDraft,
    type PersonSectionId,
  } from "./person-draft.ts";
  import ContactSection from "./sections/contact-section.svelte";
  import DatesSection from "./sections/dates-section.svelte";
  import IdentifiersSection from "./sections/identifiers-section.svelte";
  import NamesSection from "./sections/names-section.svelte";
  import OrganizationsSection from "./sections/organizations-section.svelte";
  import PronounsSection from "./sections/pronouns-section.svelte";
  import SectionHeading from "./sections/section-heading.svelte";
  import { contactRowFromDraft } from "./contact-draft.ts";
  import { identifierRowFromDraft } from "./identifier-draft.ts";

  let {
    open = $bindable(false),
    onCreated,
  }: {
    open?: boolean;
    onCreated: (entityId: string) => void;
  } = $props();

  let draft = $state<PersonDraft>(emptyPersonDraft());
  let section = $state<PersonSectionId>("names");
  let failure = $state<StatedFailure | null>(null);

  const search = directoryPickerSearch(fetch, { kinds: ["organization"] });

  const counts = $derived(personSectionCounts(draft));
  const summary = $derived(personDraftSummary(draft));
  const refusal = $derived(personDraftRefusal(draft));
  const started = $derived(personDraftStarted(draft));
  const contactRows = $derived(draft.contacts.map((contact) => contactRowFromDraft(contact, contact.id)));
  const identifierRows = $derived(
    draft.identifiers.map((identifier) => identifierRowFromDraft(identifier, identifier.id)),
  );

  function reset(): void {
    draft = emptyPersonDraft();
    section = "names";
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    // A retried submit must not make a second record, so every attempt carries its own key and the
    // server answers the repeat with the first result.
    const outcome = await createDirectoryPerson(fetch, personCreateRequest(draft), crypto.randomUUID());
    if (outcome.kind === "ok") {
      onCreated(outcome.value.id);
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
  commitLabel="Record Person"
  commitBusyLabel="Recording"
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
  {/snippet}

  {#snippet fields({ busy })}
    <!-- The record's sections as a rail; the chosen one's fields beside it. -->
    <Tabs.Root bind:value={section} orientation="vertical" class="gap-16">
      <Tabs.List class="shrink-0" style="width: 11rem">
        {#each counts as entry (entry.id)}
          <Tabs.Trigger value={entry.id} class="justify-between">
            <span>{entry.label}</span>
            {#if entry.count !== null && entry.count > 0}
              <span class="text-xs text-text-subtle tabular-nums">{entry.count}</span>
            {/if}
          </Tabs.Trigger>
        {/each}
      </Tabs.List>

      <Tabs.Content value="names" class="min-w-0 flex-auto">
        <NamesSection
          bind:name={draft.name}
          otherNames={draft.otherNames}
          disabled={busy}
          onAddOtherName={(other) => (draft.otherNames = [...draft.otherNames, { ...other, id: crypto.randomUUID() }])}
          onRemoveOtherName={(other) => (draft.otherNames = draft.otherNames.filter((entry) => entry.id !== other.id))}
        />
      </Tabs.Content>

      <Tabs.Content value="contact" class="min-w-0 flex-auto">
        <ContactSection
          rows={contactRows}
          canEdit={!busy}
          onAdd={(contact) => (draft.contacts = [...draft.contacts, { ...contact, id: crypto.randomUUID() }])}
          onRemove={(row) => (draft.contacts = draft.contacts.filter((entry) => entry.id !== row.id))}
        />
      </Tabs.Content>

      <Tabs.Content value="pronouns" class="min-w-0 flex-auto">
        <PronounsSection bind:value={draft.pronouns} disabled={busy} />
      </Tabs.Content>

      <Tabs.Content value="dates" class="min-w-0 flex-auto">
        <DatesSection bind:dateOfBirth={draft.dateOfBirth} bind:dateOfDeath={draft.dateOfDeath} disabled={busy} />
      </Tabs.Content>

      <Tabs.Content value="identifiers" class="min-w-0 flex-auto">
        <IdentifiersSection
          rows={identifierRows}
          kind="person"
          canEdit={!busy}
          onAdd={(identifier) => (draft.identifiers = [...draft.identifiers, { ...identifier, id: crypto.randomUUID() }])}
          onRemove={(row) => (draft.identifiers = draft.identifiers.filter((entry) => entry.id !== row.id))}
        />
      </Tabs.Content>

      <Tabs.Content value="organizations" class="min-w-0 flex-auto">
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
    <div class="flex flex-col gap-16">
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
