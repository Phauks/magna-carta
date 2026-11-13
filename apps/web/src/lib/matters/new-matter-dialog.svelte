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
   * HOW IT SIZES IS NOT DECIDED HERE. This window used to rebuild the record window's frame by hand
   * — the three bands, the fit-first/cap-second rule, the two panes at a ratio — and it was the
   * evidence that a pane system living in one shell is a pane system every other panel rebuilds.
   * It now opens in ActionDialog with a `context` pane, which is the record window's own right pane
   * lent to a form: the entry on the left stops at its measure, the client and the clearance on the
   * right take whatever width is left, and the frame is the frame every panel in the product shares.
   *
   * NO HELPER PROSE. This is data entry. Every visible line is a label, a value, or the honest
   * sentence a not-yet-served capability owes about what it waits on. A block with nothing in it
   * does not announce its own emptiness; it is not drawn.
   *
   * WHAT IS REAL AND WHAT IS NOT. The matter, its practice area, the client and the whole team are
   * real: the create operation stores the matter and its responsible attorney, the assignment
   * operation staffs everybody else, and a practice area the firm has not adopted yet becomes one
   * of the firm's own matter types when it is chosen. The client is a directory record, chosen and
   * never typed, and the conflict check runs against it before the matter exists. What cannot be
   * used yet says so: a matter cannot be CREATED closed (the create operation takes only Consultation
   * or Active), and money is recorded against a matter that does not exist yet. Neither is a field
   * that quietly discards what somebody typed.
   *
   * The matter NUMBER is not here and never will be. It is drawn by the firm's own counter at the
   * moment the matter opens, atomically, so that two people opening a matter at once cannot be
   * handed the same one.
   *
   * THE SAME WINDOW STARTS AN INTAKE. Opened from the intake desk (`purpose="intake"`), it records
   * a consultation and nothing else: the status is fixed at Consultation and not offered, the commit
   * says Start Intake, and the money block is not drawn, because on an intake the fee and the
   * deposit are steps of the firm's procedure and the checklist asks for them. A second window for
   * the same act would be a second place for the client field and the conflict check to drift.
   */
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as Alert from "@magna-carta/design-system/alert";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as Select from "@magna-carta/design-system/select";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Separator from "@magna-carta/design-system/separator";
  import Textarea from "@magna-carta/design-system/textarea";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import ScanSearch from "@lucide/svelte/icons/scan-search";
  import X from "@lucide/svelte/icons/x";
  import { MaturityBadge, SoonAffordance, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import { entityRecordHref } from "$lib/directory/entity-presentation.ts";
  import { readConflictsCheck, runConflictsCheck } from "$lib/conflicts/conflicts-api.ts";
  import MemberPicker from "./member-picker.svelte";
  import PracticeAreaPicker from "./practice-area-picker.svelte";
  import { OfficePicker } from "$lib/offices/index.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import {
    isCreatableMatterStatus,
    matterStatusLabel,
    CLOSED_AT_CREATION_DEPENDENCY,
    HOLD_AT_CREATION_REASON,
    MATTER_STATUSES,
  } from "./matter-status.ts";
  import { createMatterAssignment } from "./matter-assignments-api.ts";
  import {
    conflictSubjects,
    intakeAssignments,
    intakeBlockedOn,
    intakeBlockedSection,
    intakeRequest,
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
    purpose = "matter",
    prefill = null,
    session,
    matterTypes,
    matters,
    onCreated,
    onMatterTypeAdopted,
  }: {
    open?: boolean;
    /** What the window is for: a matter in any creatable status, or an intake (always consultation). */
    purpose?: "matter" | "intake";
    /**
     * What is already known about the work, from wherever the window was opened.
     *
     * The case it exists for: a receptionist takes a call, records it, and starts an intake from the
     * record they are looking at. The caller is already a Directory record by then, and asking them
     * to find that person again in this window is how a first contact stops being recorded at all.
     * Both fields stay editable — a prefill is an answer offered, never one imposed.
     */
    prefill?: { client?: PickableEntity | null; title?: string } | null;
    /** Who is asking. The responsible attorney defaults to them, and can be changed. */
    session: SessionBootstrap;
    matterTypes: readonly MatterTypeSummary[];
    /**
     * The firm's offices as the screen that opened this window already read them.
     *
     * ACCEPTED AND NO LONGER READ. The Location field is now the one office picker the product
     * uses everywhere, and that piece reads the firm's offices itself through the shared store — so
     * this list would be the same request answered twice. It stays on the signature so the three
     * screens that open this window need no change in the same round; the prop goes when they stop
     * passing it.
     */
    locations?: readonly LocationSummary[];
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
  let client = $state<PickableEntity | null>(null);
  let matterTypeId = $state<string | null>(null);
  let locationId = $state<string | null>(null);
  let description = $state("");
  let team = $state<MatterTeam>(EMPTY_MATTER_TEAM);
  let section = $state<IntakeSectionIdentifier>("matter");
  let failure = $state<StatedFailure | null>(null);
  /**
   * The matter opened but somebody was not staffed onto it. The panel stays so the names can be
   * read, and the commit is refused for the rest of its life: pressing it again would open a
   * SECOND matter against the same draft, which is the one thing worse than an unstaffed one.
   */
  let opened = $state(false);
  /** Who did not make it onto a matter that DID open. Names, never a count. */
  let staffingFailure = $state<string | null>(null);
  let numberingHint = $state(false);

  // One minted identifier, two derived from it: `$props.id()` may be called once per component.
  const identifier = $props.id();
  const closedDependencyIdentifier = `${identifier}-closed-at-creation`;

  const draft = $derived<IntakeDraft>({
    title,
    startingStatus,
    client,
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
  const closedDependency = soonDependencySentence(CLOSED_AT_CREATION_DEPENDENCY);

  // Two statuses cannot be started in, for two different reasons, and the difference is drawn:
  // Closed waits on the contract and wears the Soon mark; On Hold is a pause of work already under
  // way, so it is never a starting point and says so without promising anything.
  const STATUS_ITEMS = MATTER_STATUSES.map((status) => ({
    value: status,
    label: matterStatusLabel(status),
    creatable: isCreatableMatterStatus(status),
    unavailable: status === "hold" ? HOLD_AT_CREATION_REASON : closedDependency,
    soon: status !== "hold",
  }));

  const mayAddMatterType = $derived(
    session.permissions.includes(MANAGE_MATTER_TYPES_PERMISSION),
  );

  const roster = $derived(firmRoster.members ?? []);
  const blockedOn = $derived(intakeBlockedOn(draft));
  const blockedSection = $derived(intakeBlockedSection(draft));
  const subjects = $derived(conflictSubjects(draft));

  // The client's standing with the firm, from the docket already read. It is the fact a person
  // actually wants at this moment: whether this is a new relationship or another file for someone
  // the firm already acts for.
  // Matched on the entity where the docket carries it, and on the display name for a matter that
  // predates the link: the second is a weaker match and is honest about the one thing it can say.
  const clientMatters = $derived.by(() => {
    const chosen = client;
    if (chosen === null) return [];
    return matters.filter(
      (matter) =>
        matter.clientEntityId === chosen.identifier ||
        (matter.clientEntityId === null &&
          matter.clientDisplayName?.trim() === chosen.name.trim()),
    );
  });

  // ---- the conflict check ----------------------------------------------------------------------

  /*
   * The check runs against the client BEFORE the matter exists — an intake's whole point is finding
   * out whether the firm may act, and the engine takes a directory entity, which the client now is. Once the matter is created its own preliminary check runs on the server against
   * every party; this one is the answer a person wants while the file is still a question.
   */
  let checkRunning = $state(false);
  let checkOutcome = $state<{ id: string; hits: number; forEntityId: string } | null>(null);
  let checkFailure = $state<StatedFailure | null>(null);

  // A check answers for the client it searched. Choosing a different client puts the answer away.
  const checkForClient = $derived(
    checkOutcome !== null && client !== null && checkOutcome.forEntityId === client.identifier
      ? checkOutcome
      : null,
  );

  /** Why the check is refused, or undefined when it may run. */
  const checkRefusal = $derived.by((): string | undefined => {
    if (client === null) return "Choose the client first.";
    return undefined;
  });

  /*
   * The one line under the control, always mounted so the column's height never depends on what
   * it says: the refusal while there is one, the search while it is out, and then the answer — a
   * count, or that the check wrote its report and the report could not be read, which is a failure
   * of the read and not a shade of "no hits".
   */
  const checkLine = $derived.by((): string => {
    if (checkRunning) return "Searching the firm's record.";
    if (checkFailure !== null) return checkFailure.fallback;
    if (checkForClient === null) return checkRefusal ?? "";
    if (checkForClient.hits < 0) return "The check ran, but its report could not be read.";
    if (checkForClient.hits === 0) return "No hits.";
    if (checkForClient.hits === 1) return "One hit.";
    return `${String(checkForClient.hits)} hits.`;
  });

  async function runCheck(): Promise<void> {
    const subject = client;
    if (subject === null || checkRunning) return;
    checkRunning = true;
    checkFailure = null;
    const ran = await runConflictsCheck(
      fetch,
      {
        trigger: "preliminary",
        subjectEntityIds: [subject.identifier],
        scope: { sources: ["party", "graph"], strictness: "balanced" },
      },
      // A retried press must not write a second check into the firm's append-only log.
      crypto.randomUUID(),
    );
    if (ran.kind !== "ok") {
      checkRunning = false;
      checkFailure = stated(ran.failure, "The conflict check could not run.");
      return;
    }
    const read = await readConflictsCheck(fetch, ran.value.id);
    checkRunning = false;
    checkOutcome = {
      id: ran.value.id,
      hits: read.kind === "ok" ? read.value.hits.length : -1,
      forEntityId: subject.identifier,
    };
  }

  /** The commit says what it will do, because the outcomes are genuinely different files. */
  const commitLabel = $derived(
    startingStatus === "intake"
      ? "Start Intake"
      : startingStatus === "consultation"
        ? "Record Consultation"
        : "Open Matter",
  );
  const heading = $derived(purpose === "intake" ? "New Intake" : "New Matter");

  /*
   * The number this file will be called by, stated before it exists.
   *
   * WHICH NUMBER DEPENDS ON WHAT IS BEING STARTED, and the three answers are genuinely different
   * files, each with a run of its own: an intake draws an intake number, a consultation draws its
   * TENTATIVE number, an open matter draws the matter number. Each survives every later rung rather
   * than being replaced, so a note filed under any of them still resolves — which is why the panel
   * names the one THIS act will draw rather than the one the file will end up wearing.
   *
   * None is previewed with a value yet: nothing serves the next number on any of the three runs, and
   * a panel that invented one would be making a promise about a counter it has not asked. What the
   * reader is told is the honest half — that a number is drawn by the save, and which kind of number
   * it will be — which is what the shell renders for a preview with nothing in it. When a read
   * exists, this is the one line that changes (@magna-carta/design-system/record-reference).
   */
  const subtitle = $derived<RecordSubject>({
    reference: {
      // The rung's own word, from the status register rather than typed here — the register is
      // where a status word is given its label, and a second copy of one drifts the moment either
      // is corrected. An open matter is the exception: what it draws is called a MATTER number, and
      // the register calls that rung "Active", which is its status and not the name of its number.
      kind: startingStatus === "open" ? "Matter" : matterStatusLabel(startingStatus),
      number: null,
      standing: "preview",
    },
  });

  /**
   * Why the commit is refused, or undefined when it is not. The shell renders this beside the
   * control it refuses and puts it on the control's accessible name, so it reaches a screen reader
   * from the control it is about whether or not it is drawn.
   */
  const refusal = $derived.by((): string | undefined => {
    if (opened) {
      return "The matter is open. Close this window and staff the rest from the matter.";
    }
    return blockedOn ?? undefined;
  });

  /** Whether anything has been entered past what opening the window seeded. */
  const started = $derived(
    title.trim() !== "" ||
      client !== null ||
      description.trim() !== "" ||
      matterTypeId !== null ||
      locationId !== null ||
      team.assignedAttorneyIds.length > 0 ||
      team.supportStaffIds.length > 0,
  );

  // The matter opens under whoever is opening it until they say otherwise, which is the true answer
  // most of the time and is a named person rather than a blank the reader has to fill to proceed.
  // Seeded at every opening rather than at construction, so a window reopened after a create starts
  // from the same place a first one does.
  function reset(): void {
    title = prefill?.title ?? "";
    startingStatus = purpose === "intake" ? "intake" : "open";
    client = prefill?.client ?? null;
    checkOutcome = null;
    checkFailure = null;
    matterTypeId = null;
    locationId = null;
    description = "";
    team = teamAfterAssign(EMPTY_MATTER_TEAM, session.user.id, "responsible");
    section = "matter";
    failure = null;
    staffingFailure = null;
    numberingHint = false;
    opened = false;
  }

  /** Only a creatable status can arrive: the others are rendered disabled, so bits never sends one. */
  function chooseStatus(next: string | string[] | undefined): void {
    const chosen = Array.isArray(next) ? (next[0] ?? "") : (next ?? "");
    if (chosen === "intake" || chosen === "consultation" || chosen === "open") {
      startingStatus = chosen;
    }
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

  async function submit(): Promise<ActionOutcome> {
    const request = intakeRequest(draft);
    if (request === null) {
      if (blockedSection !== null) section = blockedSection;
      return "refused";
    }
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
      if (unstaffed.length > 0) {
        staffingFailure = unstaffed.filter((name) => name !== "").join(", ");
        opened = true;
        onCreated(outcome.value);
        return "refused";
      }
      onCreated(outcome.value);
      return "committed";
    }
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
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  {heading}
  {subtitle}
  {commitLabel}
  commitBusyLabel={purpose === "intake" ? "Starting" : "Opening"}
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
  <!-- The entry on the left, segmented into the two tabs that genuinely take turns. -->
  {#snippet fields({ busy })}
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
            <Input id="new-matter-title" bind:value={title} disabled={busy} />
          </div>
          {#if purpose === "matter"}
          <div class="flex flex-col gap-8">
            <Label id="new-matter-status-label">Status</Label>
            <Select.Root
              type="single"
              items={STATUS_ITEMS.map((item) => ({ value: item.value, label: item.label }))}
              bind:value={() => startingStatus, chooseStatus}
              allowDeselect={false}
              disabled={busy}
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
                      title={item.unavailable}
                    >
                      <span class="flex items-center gap-8">
                        {item.label}
                        {#if item.soon}
                          <MaturityBadge stage="soon" />
                        {/if}
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
          {/if}
        </div>

        <div class="grid gap-16 sm:grid-cols-2">
          <div class="flex flex-col gap-8">
            <Label for="new-matter-practice-area">Practice Area</Label>
            <PracticeAreaPicker
              {matterTypes}
              bind:value={matterTypeId}
              inputId="new-matter-practice-area"
              mayAddType={mayAddMatterType}
              disabled={busy}
              onadopted={(created) => onMatterTypeAdopted?.(created)}
            />
          </div>
          <div class="flex flex-col gap-8">
            <Label for="new-matter-location">Location</Label>
            <!-- The office the matter is RUN OUT OF, picked by the one piece that picks an office
                 anywhere in the product — so what a firm's offices are is answered in one place
                 and a matter's office is the same record the Offices screen manages. Where the
                 matter's paper FILE ends up is a different fact, recorded on the status window
                 once there is a folder. -->
            <OfficePicker
              bind:value={locationId}
              inputId="new-matter-location"
              label="Location"
              disabled={busy}
              whenEmpty="No offices are set up."
            />
          </div>
        </div>

        <div class="flex flex-col gap-8">
          <Label for="new-matter-description">Description</Label>
          <Textarea
            id="new-matter-description"
            bind:value={description}
            disabled={busy}
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
            disabled={busy}
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
                disabled={busy}
              />
              {#if seat.held(team).length > 0}
                <ul class="flex flex-wrap gap-4">
                  {#each seat.held(team) as memberId (memberId)}
                    <li>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
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
  {/snippet}

  <!-- The client and the clearance on the right, permanently in view whichever tab is open. -->
  {#snippet context({ busy })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="new-matter-client">Client</Label>
        <!-- From the directory, never typed: a name typed here is how one client ends up in the
             book twice. Someone the directory does not hold yet is added there first. -->
        <DirectoryEntityPicker
          bind:value={client}
          label="Client"
          inputId="new-matter-client"
          disabled={busy}
          disabledReason={busy ? "The matter is being opened." : undefined}
        />
      </div>

      <div class="flex flex-col gap-8">
        <Label id="new-matter-client-record-label">Client Record</Label>
        <!-- One control that becomes a link the moment there is a record to open: the draft in
             this window is why it opens beside it rather than in its place. -->
        <Button
          variant="secondary"
          href={client === null ? undefined : entityRecordHref(client.identifier)}
          {...opensBeside("unsaved-work")}
          disabled={client === null}
          aria-labelledby="new-matter-client-record-label"
        >
          <ExternalLink class="size-16" aria-hidden="true" />
          Open Client Record
        </Button>
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
        {#if checkFailure !== null}
          <FailureNotice
            failure={checkFailure.failure}
            title="The Conflict Check Did Not Run"
            fallback={checkFailure.fallback}
            whenSilent={checkFailure.whenSilent}
          />
        {/if}
        <!-- The label holds still while the check runs: a control that changes width reads as the
             value itself changing. The refusal rides the accessible name as the shell's does. -->
        <Button
          variant="secondary"
          disabled={busy || checkRefusal !== undefined || checkRunning}
          aria-label={checkRefusal === undefined ? undefined : `Run Conflict Check: ${checkRefusal}`}
          onclick={() => void runCheck()}
        >
          <ScanSearch class="size-16" aria-hidden="true" />
          Run Conflict Check
        </Button>
        <!-- Always mounted: the number is the answer, and the report is where it is weighed. -->
        <p class="text-sm" aria-live="polite">
          {checkLine}
          {#if checkForClient !== null}
            <a
              class="underline underline-offset-2"
              href={`/conflicts/checks/${encodeURIComponent(checkForClient.id)}`}
              {...opensBeside("unsaved-work")}
            >
              Open the report
            </a>
          {/if}
        </p>
      </div>

      {#if purpose === "matter"}
      <Separator />

      <div class="flex flex-col gap-8">
        <!-- Money is recorded AGAINST a matter, so neither of these can happen before one
             exists: the intake would have to hand the new matter on to billing and to trust.
             That hand-off is the dependency, not the ledgers, which both already take these
             writes. On an intake the fee and the deposit are steps of the firm's procedure, so
             the block is not drawn there. -->
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
      {/if}
    </div>
  {/snippet}

  {#snippet notice()}
    {#if staffingFailure !== null}
      <Alert.Root variant="warning">
        <Alert.Title>The Matter Is Open, And Not Everybody Was Staffed Onto It</Alert.Title>
        <Alert.Description>{staffingFailure}</Alert.Description>
      </Alert.Root>
    {/if}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title={purpose === "intake" ? "The Intake Was Not Started" : "The Matter Was Not Opened"}
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      >
        {#if numberingHint}
          <a class="ms-4 underline underline-offset-2" href="/settings/numbering">
            Numbering
          </a>
        {/if}
      </FailureNotice>
    {/if}
  {/snippet}
</ActionDialog>
