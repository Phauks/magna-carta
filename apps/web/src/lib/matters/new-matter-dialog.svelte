<script lang="ts">
  /*
   * Opening a matter.
   *
   * This is not a form with a submit button. A firm taking on work does four separable things, and
   * the window is segmented into them so that each is a place a person can be sent to rather than a
   * stretch of one long column: what the work IS, who it is FOR, who inside the firm CARRIES it,
   * and whether the firm may take it at all. The last of those is the conflict check and the money
   * that changes hands before the file is worked.
   *
   * The window is wide and each section is short, so the whole thing sits on one screen and nothing
   * scrolls. That is the point of the segmentation: a person filling in the second section is not
   * scrolling past the first, and a person who only needs to change the responsible attorney opens
   * one section rather than reading four.
   *
   * WHAT IS REAL AND WHAT IS NOT. The matter, the client and the responsible attorney are real:
   * they are what the create operation stores, and the roster read means a colleague can be named
   * rather than the matter opening under whoever happened to press the button. The rest of the team,
   * the conflict check and the money are designed and rendered and cannot yet be used, each saying
   * what it waits on. None of them is a field that quietly discards what somebody typed.
   *
   * The matter NUMBER is not here and never will be. It is drawn by the firm's own counter at the
   * moment the matter opens, atomically, so that two people opening a matter at once cannot be
   * handed the same one.
   */
  import { untrack } from "svelte";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import ScanSearch from "@lucide/svelte/icons/scan-search";
  import X from "@lucide/svelte/icons/x";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import ClientPicker from "./client-picker.svelte";
  import MemberPicker from "./member-picker.svelte";
  import VocabularyPicker from "./vocabulary-picker.svelte";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { matterStatusLabel, MATTER_STATUSES, type MatterStatus } from "./matter-status.ts";
  import { createMatterAssignment } from "./matter-assignments-api.ts";
  import {
    conflictSubjects,
    intakeAssignments,
    intakeBlockedOn,
    intakeBlockedSection,
    intakeRequest,
    knownClientNames,
    teamAfterAssign,
    teamAfterRelease,
    teamMemberIds,
    EMPTY_MATTER_TEAM,
    INTAKE_SECTIONS,
    type IntakeDraft,
    type IntakeSectionIdentifier,
    type MatterTeam,
    type StartingStatus,
    type TeamSeat,
  } from "./matter-intake.ts";
  import {
    createMatter,
    type LocationSummary,
    type MatterSummary,
    type MatterTypeSummary,
    type SessionBootstrap,
  } from "./matters-api.ts";

  let {
    open = $bindable(false),
    session,
    matterTypes,
    locations,
    matters,
    onCreated,
  }: {
    open?: boolean;
    /** Who is asking. The responsible attorney defaults to them, and can be changed. */
    session: SessionBootstrap;
    matterTypes: readonly MatterTypeSummary[];
    locations: readonly LocationSummary[];
    /** The docket as loaded, which is where the clients the firm already has come from. */
    matters: readonly MatterSummary[];
    onCreated: (created: { matterId: string; matterNumber: string | null }) => void;
  } = $props();

  // ---- the draft -------------------------------------------------------------------------------

  let title = $state("");
  let startingStatus = $state<StartingStatus>("open");
  let clientName = $state("");
  let matterTypeId = $state<string | null>(null);
  let locationId = $state<string | null>(null);
  let description = $state("");
  let team = $state<MatterTeam>(EMPTY_MATTER_TEAM);
  let section = $state<IntakeSectionIdentifier>("matter");
  let submitting = $state(false);
  let failure = $state<string | null>(null);
  /** Who did not make it onto a matter that DID open. Names, never a count. */
  let staffingFailure = $state<string | null>(null);
  let numberingHint = $state(false);

  const blockedDescriptionIdentifier = $props.id();

  // The matter opens under whoever is opening it until they say otherwise, which is the true answer
  // most of the time and is a named person rather than a blank the reader has to fill to proceed.
  // Seeded when the window opens rather than at construction, so a window reopened after a create
  // starts from the same place a first one does.
  $effect(() => {
    if (!open) return;
    // Untracked: this reads the team only to decide whether it has been seeded, and writes it. A
    // tracked read of what it writes is a loop waiting for the guard to be edited away.
    untrack(() => {
      if (team.responsibleMemberId === null) {
        team = teamAfterAssign(team, session.user.id, "responsible");
      }
    });
  });

  const draft = $derived<IntakeDraft>({
    title,
    startingStatus,
    clientName,
    matterTypeId,
    locationId,
    description,
    team,
  });

  // Closed is somewhere a matter arrives, never somewhere it starts, so it is not offered. The
  // words are the lifecycle register's own, so this control and the Status column cannot disagree.
  const STARTING_STATUS_ITEMS: readonly { value: StartingStatus; label: string }[] =
    MATTER_STATUSES.filter((status): status is StartingStatus => status !== "closed").map(
      (status: MatterStatus) => ({ value: status as StartingStatus, label: matterStatusLabel(status) }),
    );

  const typeOptions = $derived(
    matterTypes.filter((type) => type.active).map((type) => ({ id: type.id, name: type.name })),
  );
  const locationOptions = $derived(
    locations
      .filter((location) => location.status === "active")
      .map((location) => ({ id: location.id, name: location.name })),
  );

  const roster = $derived(firmRoster.members ?? []);
  const clients = $derived(knownClientNames(matters));
  const blockedOn = $derived(intakeBlockedOn(draft));
  const blockedSection = $derived(intakeBlockedSection(draft));
  const subjects = $derived(conflictSubjects(draft));

  // The client's standing with the firm, from the docket already read. It is the fact a person
  // actually wants at this moment: whether this is a new relationship or another file for someone
  // the firm already acts for.
  const clientMatters = $derived(
    clientName.trim() === ""
      ? []
      : matters.filter((matter) => matter.clientDisplayName?.trim() === clientName.trim()),
  );

  /** The primary says what it will do, because the two outcomes are genuinely different files. */
  const primaryLabel = $derived(
    submitting
      ? "Opening"
      : startingStatus === "prospective"
        ? "Record Consultation"
        : "Open Matter",
  );

  function reset(): void {
    title = "";
    startingStatus = "open";
    clientName = "";
    matterTypeId = null;
    locationId = null;
    description = "";
    team = EMPTY_MATTER_TEAM;
    section = "matter";
    failure = null;
    staffingFailure = null;
    numberingHint = false;
  }

  function nameResponsible(memberId: string): void {
    team = teamAfterAssign(team, memberId, "responsible");
  }

  function addToSeat(memberId: string, seat: TeamSeat): void {
    team = teamAfterAssign(team, memberId, seat);
  }

  /** A member's name, or their handle's absence: a roster that cannot be read names nobody. */
  function memberName(memberId: string): string {
    return roster.find((member) => member.userId === memberId)?.displayName ?? "";
  }

  const SEATS: readonly {
    id: Exclude<TeamSeat, "responsible">;
    label: string;
    held: (team: MatterTeam) => readonly string[];
  }[] = [
    {
      id: "assignedAttorney",
      label: "Assigned Attorneys",
      held: (current) => current.assignedAttorneyIds,
    },
    { id: "supportStaff", label: "Support Staff", held: (current) => current.supportStaffIds },
  ];

  async function submit(): Promise<void> {
    const request = intakeRequest(draft);
    if (request === null || submitting) {
      if (blockedSection !== null) section = blockedSection;
      return;
    }
    submitting = true;
    failure = null;
    staffingFailure = null;
    numberingHint = false;
    // A retried submit must not open a second matter, so every attempt carries its own key and the
    // server answers the repeat with the first result.
    const outcome = await createMatter(fetch, request, crypto.randomUUID());
    if (outcome.kind === "ok") {
      // The team is a second write, one per person, against the matter that now exists. A person
      // who does not land is reported BY NAME against a matter that did: saying "the matter was not
      // opened" would be false, and saying nothing would leave somebody off a file they were put on.
      const unstaffed: string[] = [];
      for (const assignment of intakeAssignments(draft)) {
        const staffed = await createMatterAssignment(
          fetch,
          outcome.value.matterId,
          assignment,
          crypto.randomUUID(),
        );
        if (staffed.kind !== "ok") unstaffed.push(memberName(assignment.memberUserId));
      }
      submitting = false;
      if (unstaffed.length > 0) {
        staffingFailure = unstaffed.filter((name) => name !== "").join(", ");
        onCreated(outcome.value);
        return;
      }
      onCreated(outcome.value);
      reset();
      open = false;
      return;
    }
    submitting = false;
    failure =
      outcome.kind === "transport"
        ? "Nothing answered. The matter was not opened, so nothing was half-created."
        : (outcome.problem.detail ?? "The matter could not be opened.");
    // A refused OPEN is almost always the number draw: the firm has no active numbering scheme, or
    // its active one wants a segment this matter cannot supply. Both are settings, and both are
    // fixed in one place, so the refusal says where rather than leaving a person to guess.
    numberingHint =
      outcome.kind === "problem" && outcome.problem.status === 422 && startingStatus === "open";
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-4xl">
    <Dialog.Title>New Matter</Dialog.Title>
    <Dialog.Description class="sr-only">
      Opening a matter: the matter, its client, the people who carry it, and its clearance.
    </Dialog.Description>

    <Tabs.Root bind:value={section} class="flex flex-col gap-16">
      <Tabs.List>
        {#each INTAKE_SECTIONS as intakeSection (intakeSection.id)}
          <Tabs.Trigger value={intakeSection.id}>{intakeSection.label}</Tabs.Trigger>
        {/each}
      </Tabs.List>

      <!-- ---------- The matter ---------- -->
      <Tabs.Content value="matter" class="flex flex-col gap-16">
        <div class="flex flex-col gap-8">
          <Label for="new-matter-title">Title</Label>
          <Input id="new-matter-title" bind:value={title} disabled={submitting} placeholder="Title" />
        </div>

        <div class="grid gap-16 sm:grid-cols-3">
          <div class="flex flex-col gap-8">
            <Label id="new-matter-status-label">How It Starts</Label>
            <Select.Root
              type="single"
              items={[...STARTING_STATUS_ITEMS]}
              bind:value={startingStatus}
              allowDeselect={false}
              disabled={submitting}
            >
              <Select.Trigger aria-labelledby="new-matter-status-label">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {#each STARTING_STATUS_ITEMS as item (item.value)}
                  <Select.Item value={item.value} label={item.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          <div class="flex flex-col gap-8">
            <Label for="new-matter-practice-area">Practice Area</Label>
            <VocabularyPicker
              options={typeOptions}
              bind:value={matterTypeId}
              inputId="new-matter-practice-area"
              label="Practice Area"
              whenEmpty="No matter types are set up."
            />
          </div>
          <div class="flex flex-col gap-8">
            <Label for="new-matter-location">Location</Label>
            <VocabularyPicker
              options={locationOptions}
              bind:value={locationId}
              inputId="new-matter-location"
              label="Location"
              whenEmpty="No Locations are set up."
            />
          </div>
        </div>

        <div class="flex flex-col gap-8">
          <Label for="new-matter-description">Description</Label>
          <Textarea
            id="new-matter-description"
            bind:value={description}
            disabled={submitting}
            placeholder="Description"
            rows={3}
          />
        </div>
      </Tabs.Content>

      <!-- ---------- Client ---------- -->
      <Tabs.Content value="client" class="flex flex-col gap-16">
        <div class="grid gap-16 sm:grid-cols-2">
          <div class="flex flex-col gap-8">
            <Label for="new-matter-client">Client</Label>
            <ClientPicker
              knownClients={clients}
              bind:value={clientName}
              inputId="new-matter-client"
              disabled={submitting}
            />
          </div>
          <div class="flex flex-col gap-8">
            <Label id="new-matter-client-record-label">Client Record</Label>
            <SoonAffordance reason="the client directory">
              {#snippet control(soon)}
                <Button
                  variant="secondary"
                  aria-labelledby="new-matter-client-record-label"
                  {...soon}
                >
                  <ExternalLink class="size-16" aria-hidden="true" />
                  Open Client Record
                </Button>
              {/snippet}
            </SoonAffordance>
          </div>
        </div>

        <div class="flex flex-col gap-8">
          <Label id="new-matter-client-standing">This Client's Matters</Label>
          {#if clientMatters.length === 0}
            <p aria-labelledby="new-matter-client-standing" class="text-sm text-text-muted">
              None on the docket.
            </p>
          {:else}
            <ul aria-labelledby="new-matter-client-standing" class="flex flex-col gap-4">
              {#each clientMatters.slice(0, 4) as clientMatter (clientMatter.id)}
                <li class="flex items-center gap-8 text-sm">
                  <span class="tabular-nums text-text-muted">
                    {clientMatter.matterNumber ?? matterStatusLabel(clientMatter.status)}
                  </span>
                  <span class="truncate">{clientMatter.title}</span>
                  <Badge variant="neutral">{matterStatusLabel(clientMatter.status)}</Badge>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </Tabs.Content>

      <!-- ---------- People ---------- -->
      <Tabs.Content value="people" class="flex flex-col gap-16">
        <div class="flex flex-col gap-8">
          <Label for="new-matter-responsible">Responsible Attorney</Label>
          <MemberPicker
            members={roster}
            value={team.responsibleMemberId}
            onpick={nameResponsible}
            inputId="new-matter-responsible"
            label="Responsible Attorney"
            disabled={submitting}
          />
          {#if firmRoster.failure !== null}
            <Alert.Root variant="danger">
              <Alert.Title>The Roster Could Not Be Read</Alert.Title>
              <Alert.Description>{firmRoster.failure}</Alert.Description>
            </Alert.Root>
          {/if}
        </div>

        <div class="grid gap-16 sm:grid-cols-2">
          {#each SEATS as seat (seat.id)}
            <div class="flex flex-col gap-8">
              <Label for="new-matter-{seat.id}">{seat.label}</Label>
              <MemberPicker
                members={roster}
                exclude={teamMemberIds(team)}
                onpick={(memberId) => addToSeat(memberId, seat.id)}
                inputId="new-matter-{seat.id}"
                label={seat.label}
                disabled={submitting}
              />
              {#if seat.held(team).length > 0}
                <ul class="flex flex-wrap gap-4">
                  {#each seat.held(team) as memberId (memberId)}
                    <li>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={submitting}
                        aria-label="Take {memberName(memberId)} off this matter"
                        onclick={() => (team = teamAfterRelease(team, memberId))}
                      >
                        {memberName(memberId)}
                        <X class="size-16" aria-hidden="true" />
                      </Button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/each}
        </div>
      </Tabs.Content>

      <!-- ---------- Conflicts and money ---------- -->
      <Tabs.Content value="clearance" class="grid gap-24 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label id="new-matter-conflict-label">Conflict Check</Label>
          {#if subjects.length === 0}
            <p aria-labelledby="new-matter-conflict-label" class="text-sm text-text-muted">
              Nothing to search yet.
            </p>
          {:else}
            <ul aria-labelledby="new-matter-conflict-label" class="flex flex-col gap-4">
              {#each subjects as subject (subject)}
                <li class="truncate text-sm">{subject}</li>
              {/each}
            </ul>
          {/if}
          <!-- The check itself is servable. What it takes is directory entities, and a client
               typed as a name here is not one, so the step waits on the client being a record
               rather than on the engine that would search for it. -->
          <SoonAffordance reason="the client's directory record" reasonPlacement="line">
            {#snippet control(soon)}
              <Button variant="secondary" {...soon}>
                <ScanSearch class="size-16" aria-hidden="true" />
                Run Conflict Check
              </Button>
            {/snippet}
          </SoonAffordance>
        </div>

        <div class="flex flex-col gap-8">
          <!-- Money is recorded AGAINST a matter, so neither of these can happen before one
               exists: the intake would have to hand the new matter on to billing and to trust. That
               hand-off is the dependency, not the ledgers, which both already take these writes. -->
          <Label id="new-matter-consultation-fee-label">Consultation Fee</Label>
          <SoonAffordance reason="the intake handing a new matter to billing" reasonPlacement="line">
            {#snippet control(soon)}
              <Input
                aria-labelledby="new-matter-consultation-fee-label"
                placeholder="Consultation Fee"
                {...soon}
              />
            {/snippet}
          </SoonAffordance>
          <Label id="new-matter-deposit-label">Deposit Into Trust</Label>
          <SoonAffordance reason="the intake handing a new matter to trust" reasonPlacement="line">
            {#snippet control(soon)}
              <Input
                aria-labelledby="new-matter-deposit-label"
                placeholder="Deposit Into Trust"
                {...soon}
              />
            {/snippet}
          </SoonAffordance>
        </div>
      </Tabs.Content>
    </Tabs.Root>

    {#if staffingFailure !== null}
      <Alert.Root variant="warning">
        <Alert.Title>The Matter Is Open, And Not Everybody Was Staffed Onto It</Alert.Title>
        <Alert.Description>{staffingFailure}</Alert.Description>
      </Alert.Root>
    {/if}

    {#if failure !== null}
      <Alert.Root variant="danger">
        <Alert.Title>The Matter Was Not Opened</Alert.Title>
        <Alert.Description>
          {failure}
          {#if numberingHint}
            <a class="ms-4 underline underline-offset-2" href="/settings/matter-numbering">
              Matter numbering
            </a>
          {/if}
        </Alert.Description>
      </Alert.Root>
    {/if}

    <div class="flex items-center gap-8">
      <Button
        variant="primary"
        disabled={blockedOn !== null || submitting}
        title={blockedOn ?? undefined}
        aria-describedby={blockedOn === null ? undefined : blockedDescriptionIdentifier}
        onclick={submit}
      >
        {primaryLabel}
      </Button>
      <Dialog.Close
        class={buttonClasses({ variant: "secondary", size: "default" })}
        disabled={submitting}
      >
        Cancel
      </Dialog.Close>
      <!-- A disabled control cannot be hovered or focused, so what is missing reaches a screen
           reader whether or not it is drawn. -->
      <p id={blockedDescriptionIdentifier} class="sr-only">{blockedOn ?? ""}</p>
    </div>
  </Dialog.Content>
</Dialog.Root>
