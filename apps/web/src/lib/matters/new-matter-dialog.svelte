<script lang="ts">
  /*
   * Opening a matter — ONE screen, a left side and a right side.
   *
   * WHY IT IS NOT A WIZARD AND NOT A LONG COLUMN. Opening a matter is a process, not a form: the
   * firm records what the work is, who it is for and who carries it, and it clears the work to be
   * taken at all. A wizard hides three of those from the person doing the fourth. So the window is
   * WIDE, and everything that matters is in view at once: the entry on the left, segmented into the
   * two tabs that genuinely take turns, and the client and the clearance on the right, permanently
   * in view whichever tab is open.
   *
   * WHY THE CLIENT AND THE CLEARANCE ARE THE RIGHT SIDE AND NOT TABS. Who the work is for is the
   * fact every other answer on this screen is about — the caption is written about them, the
   * conflict check is run on them, the money is theirs. And the conflict check and the money are
   * not more data being entered: they are the gate the entry has to pass. A client behind a tab is
   * a client somebody writes the caption without; a gate behind a tab is a gate somebody has to
   * remember to go and look at. The right side also reads LIVE — the subjects a conflict check
   * would run against are derived from the title and the client as they are typed, so it answers
   * the left.
   *
   * HOW IT SIZES. Three bands: a header that never moves, a body, and an action bar of fixed
   * geometry. A window that FITS does not scroll — the panel sizes to its content. One that does
   * not fit caps at the viewport and then the BODY ALONE moves, so a long entry can no more push
   * its own commit off the screen than it can hide the close. That is the same ordered preference
   * the record window settled on, and the reason is the same: the common case should not be traded
   * away to simplify the rare one.
   *
   * NO HELPER PROSE. This is data entry. Every visible line is a label, a value, or the honest
   * sentence a not-yet-served capability owes about what it waits on. A block with nothing in it
   * does not announce its own emptiness; it is not drawn.
   *
   * WHAT IS REAL AND WHAT IS NOT. The matter, its practice area, the client and the whole team are
   * real: the create operation stores the matter and its responsible attorney, the assignment
   * operation staffs everybody else, and a practice area the firm has not adopted yet becomes one
   * of the firm's own matter types when it is chosen. What cannot be used yet says so: a matter
   * cannot be CREATED closed (the create operation takes only Prospective or Active), the conflict
   * check needs the client to be a directory record rather than a typed name, and money is recorded
   * against a matter that does not exist yet. None of them is a field that quietly discards what
   * somebody typed.
   *
   * The matter NUMBER is not here and never will be. It is drawn by the firm's own counter at the
   * moment the matter opens, atomically, so that two people opening a matter at once cannot be
   * handed the same one.
   */
  import { untrack } from "svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Separator from "@magna-carta/design-system/separator";
  import Textarea from "@magna-carta/design-system/textarea";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import ScanSearch from "@lucide/svelte/icons/scan-search";
  import X from "@lucide/svelte/icons/x";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import { soonDependencySentence } from "$lib/maturity/soon-affordance.ts";
  import ClientPicker from "./client-picker.svelte";
  import MemberPicker from "./member-picker.svelte";
  import PracticeAreaPicker from "./practice-area-picker.svelte";
  import VocabularyPicker from "./vocabulary-picker.svelte";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import {
    isCreatableMatterStatus,
    matterStatusLabel,
    CLOSED_AT_CREATION_DEPENDENCY,
    MATTER_STATUSES,
  } from "./matter-status.ts";
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
  import { MANAGE_MATTER_TYPES_PERMISSION } from "./matters-api.ts";

  let {
    open = $bindable(false),
    session,
    matterTypes,
    locations,
    matters,
    onCreated,
    onMatterTypeAdopted,
  }: {
    open?: boolean;
    /** Who is asking. The responsible attorney defaults to them, and can be changed. */
    session: SessionBootstrap;
    matterTypes: readonly MatterTypeSummary[];
    locations: readonly LocationSummary[];
    /** The docket as loaded, which is where the clients the firm already has come from. */
    matters: readonly MatterSummary[];
    onCreated: (created: {
      matterId: string;
      matterNumber: string | null;
      consultationNumber: string | null;
    }) => void;
    /** A practice area this window added to the firm, so the screen that owns the list holds it. */
    onMatterTypeAdopted?: (created: MatterTypeSummary) => void;
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
  let failure = $state<StatedFailure | null>(null);
  /** Who did not make it onto a matter that DID open. Names, never a count. */
  let staffingFailure = $state<string | null>(null);
  let numberingHint = $state(false);

  // One minted identifier, two derived from it: `$props.id()` may be called once per component.
  const identifier = $props.id();
  const blockedDescriptionIdentifier = `${identifier}-blocked`;
  const closedDependencyIdentifier = `${identifier}-closed-at-creation`;

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

  /**
   * Every lifecycle status a matter can hold, in lifecycle order, each saying whether a matter can
   * be STARTED in it. The words are the product's own register, so this control and the docket's
   * Status column cannot disagree; Closed is offered and refused rather than hidden, because a firm
   * that wants to record a concluded matter should see that the state exists.
   */
  const STATUS_ITEMS = MATTER_STATUSES.map((status) => ({
    value: status,
    label: matterStatusLabel(status),
    creatable: isCreatableMatterStatus(status),
  }));

  const closedDependency = soonDependencySentence(CLOSED_AT_CREATION_DEPENDENCY);

  const locationOptions = $derived(
    locations
      .filter((location) => location.status === "active")
      .map((location) => ({ id: location.id, name: location.name })),
  );

  const mayAddMatterType = $derived(
    session.permissions.includes(MANAGE_MATTER_TYPES_PERMISSION),
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

  /** Only a creatable status can arrive: the others are rendered disabled, so bits never sends one. */
  function chooseStatus(next: string | string[] | undefined): void {
    const chosen = Array.isArray(next) ? (next[0] ?? "") : (next ?? "");
    if (chosen === "prospective" || chosen === "open") startingStatus = chosen;
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

  /**
   * The seats that hold ANY NUMBER of people. The responsible attorney is not one of them and is
   * rendered on its own: exactly one member is accountable for a matter, and that is what the
   * contract stores on the matter itself. Everybody else joins as their own assignment, so these
   * two lists are as long as the firm needs them to be.
   */
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
    failure = stated(
      outcome.failure,
      "The matter could not be opened.",
      "The matter was not opened, so nothing was half-created.",
    );
    // A refused OPEN is almost always the number draw: the firm has no active numbering scheme, or
    // its active one wants a segment this matter cannot supply. Both are settings, and both are
    // fixed in one place, so the refusal says where rather than leaving a person to guess.
    numberingHint =
      outcome.kind === "problem" && outcome.problem.status === 422 && startingStatus === "open";
  }
</script>

<Dialog.Root bind:open>
  <!-- Fit first, then cap: the panel sizes to its content and stops at the viewport, where the
       body alone takes the movement. The header and the action bar never scroll away. -->
  <Dialog.Content class="flex max-h-svh w-full max-w-record-window flex-col gap-0 p-0">
    <div class="flex flex-none flex-col gap-4 px-24 py-16">
      <Dialog.Title>New Matter</Dialog.Title>
      <Dialog.Description class="sr-only">
        Opening a matter: the matter, the people who carry it, its client, and its clearance.
      </Dialog.Description>
    </div>

    <Separator />

    <div class="mc-scrollbar min-h-0 flex-1 overflow-y-auto px-24 py-16">
      <!-- The entry left, the client and the clearance right. Two thirds and one third, and on a
           narrow viewport they stack rather than squeezing the fields. -->
      <div class="grid gap-24 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <Tabs.Root bind:value={section} class="flex flex-col gap-16">
            <Tabs.List>
              {#each INTAKE_SECTIONS as intakeSection (intakeSection.id)}
                <Tabs.Trigger value={intakeSection.id}>{intakeSection.label}</Tabs.Trigger>
              {/each}
            </Tabs.List>

            <!-- ---------- Matter ---------- -->
            <Tabs.Content value="matter" class="flex flex-col gap-16">
              <div class="grid gap-16 sm:grid-cols-2">
                <div class="flex flex-col gap-8">
                  <Label for="new-matter-title">Title</Label>
                  <Input id="new-matter-title" bind:value={title} disabled={submitting} />
                </div>
                <div class="flex flex-col gap-8">
                  <Label id="new-matter-status-label">Status</Label>
                  <Select.Root
                    type="single"
                    items={STATUS_ITEMS.map((item) => ({ value: item.value, label: item.label }))}
                    bind:value={() => startingStatus, chooseStatus}
                    allowDeselect={false}
                    disabled={submitting}
                  >
                    <Select.Trigger
                      aria-labelledby="new-matter-status-label"
                      aria-describedby={closedDependencyIdentifier}
                    >
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      {#each STATUS_ITEMS as item (item.value)}
                        {#if item.creatable}
                          <Select.Item value={item.value} label={item.label} />
                        {:else}
                          <!-- Rendered, disabled, and saying what it waits on: a firm does start a
                               file that is already finished, and hiding the word would say the
                               state does not exist rather than that it cannot be reached yet. -->
                          <Select.Item
                            value={item.value}
                            label={item.label}
                            disabled
                            title={closedDependency}
                          >
                            <span class="flex items-center gap-8">
                              {item.label}
                              <MaturityBadge stage="soon" />
                            </span>
                          </Select.Item>
                        {/if}
                      {/each}
                    </Select.Content>
                  </Select.Root>
                  <p id={closedDependencyIdentifier} class="text-xs text-text-muted">
                    {closedDependency}
                  </p>
                </div>
              </div>

              <div class="grid gap-16 sm:grid-cols-2">
                <div class="flex flex-col gap-8">
                  <Label for="new-matter-practice-area">Practice Area</Label>
                  <PracticeAreaPicker
                    {matterTypes}
                    bind:value={matterTypeId}
                    inputId="new-matter-practice-area"
                    mayAddType={mayAddMatterType}
                    disabled={submitting}
                    onadopted={(created) => onMatterTypeAdopted?.(created)}
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
                  rows={3}
                />
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

              <!-- Both of these hold ANY NUMBER of people: the field stays ready for the next
                   colleague after each pick, and everybody chosen sits beneath it as their own
                   control that takes them back off. -->
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
          </Tabs.Root>
        </div>

        <!-- ---------- The client, and the gate its work has to pass ---------- -->
        <div class="flex flex-col gap-16">
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

          <!-- Drawn only when there is something to draw: an empty block that announces its own
               emptiness is prose, and this is a data-entry surface. -->
          {#if clientMatters.length > 0}
            <div class="flex flex-col gap-8">
              <Label id="new-matter-client-standing">This Client's Matters</Label>
              <ul aria-labelledby="new-matter-client-standing" class="flex flex-col gap-4">
                {#each clientMatters.slice(0, 4) as clientMatter (clientMatter.id)}
                  <li class="flex items-center gap-8 text-sm">
                    <span class="tabular-nums text-text-muted">
                      {clientMatter.matterNumber ??
                        clientMatter.consultationNumber ??
                        matterStatusLabel(clientMatter.status)}
                    </span>
                    <span class="truncate">{clientMatter.title}</span>
                    <Badge variant="neutral">{matterStatusLabel(clientMatter.status)}</Badge>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          <Separator />

          <div class="flex flex-col gap-8">
            <Label id="new-matter-conflict-label">Conflict Check</Label>
            {#if subjects.length > 0}
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

          <Separator />

          <div class="flex flex-col gap-8">
            <!-- Money is recorded AGAINST a matter, so neither of these can happen before one
                 exists: the intake would have to hand the new matter on to billing and to trust.
                 That hand-off is the dependency, not the ledgers, which both already take these
                 writes. -->
            <Label id="new-matter-consultation-fee-label">Consultation Fee</Label>
            <SoonAffordance
              reason="the intake handing a new matter to billing"
              reasonPlacement="line"
            >
              {#snippet control(soon)}
                <Input aria-labelledby="new-matter-consultation-fee-label" {...soon} />
              {/snippet}
            </SoonAffordance>
            <Label id="new-matter-deposit-label">Deposit Into Trust</Label>
            <SoonAffordance reason="the intake handing a new matter to trust" reasonPlacement="line">
              {#snippet control(soon)}
                <Input aria-labelledby="new-matter-deposit-label" {...soon} />
              {/snippet}
            </SoonAffordance>
          </div>
        </div>
      </div>
    </div>

    <!-- The outcome band sits with the actions rather than at the end of the body: a refusal that
         scrolled out of sight while somebody reached for the button would be a refusal nobody read. -->
    {#if staffingFailure !== null || failure !== null}
      <div class="flex flex-none flex-col gap-8 px-24 pb-16">
        {#if staffingFailure !== null}
          <Alert.Root variant="warning">
            <Alert.Title>The Matter Is Open, And Not Everybody Was Staffed Onto It</Alert.Title>
            <Alert.Description>{staffingFailure}</Alert.Description>
          </Alert.Root>
        {/if}
        {#if failure !== null}
          <FailureNotice
            failure={failure.failure}
            title="The Matter Was Not Opened"
            fallback={failure.fallback}
            whenSilent={failure.whenSilent}
          >
            {#if numberingHint}
              <a class="ms-4 underline underline-offset-2" href="/settings/matter-numbering">
                Matter numbering
              </a>
            {/if}
          </FailureNotice>
        {/if}
      </div>
    {/if}

    <Separator />

    <div class="flex flex-none items-center justify-end gap-8 px-24 py-12">
      <!-- A disabled control cannot be hovered or focused, so what is missing reaches a screen
           reader whether or not it is drawn. -->
      <p id={blockedDescriptionIdentifier} class="sr-only">{blockedOn ?? ""}</p>
      <Dialog.Close
        class={buttonClasses({ variant: "secondary", size: "default" })}
        disabled={submitting}
      >
        Cancel
      </Dialog.Close>
      <Button
        variant="primary"
        disabled={blockedOn !== null || submitting}
        title={blockedOn ?? undefined}
        aria-describedby={blockedOn === null ? undefined : blockedDescriptionIdentifier}
        onclick={submit}
      >
        {primaryLabel}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
