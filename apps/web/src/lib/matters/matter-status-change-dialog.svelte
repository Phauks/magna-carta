<script lang="ts">
  /*
   * The panel a matter's status is CHANGED in, and the only one.
   *
   * WHY IT EXISTS, AND WHAT IT REPLACES (owner ruling, 2026-09-14). The status seal is a pillbox
   * again: it states the status and nothing more. The steps used to hang off it as a menu, and
   * before that they stood as a row of verbs inside the status window — Open Matter, Close Matter,
   * Put On Hold — each one a press that committed before the reader had been told what it would
   * do or what it required. Both arrangements asked somebody to pick a verb with the reasoning
   * somewhere else. One control now says only that the status is being changed, and it opens this,
   * where the reasoning is.
   *
   * IT IS STILL NOT A STATUS PICKER. What it lists is what the lifecycle allows from where the
   * matter stands — never the five statuses — and the reader is choosing among those steps, each of
   * which is one POST that takes no status at all (matter-lifecycle.ts holds the model and the
   * argument). Naming what each step requires on the way past is what a menu of verbs could not do.
   *
   * WHAT IT SAYS, IN THE ORDER IT SAYS IT. Where the matter stands; the steps available from here,
   * each carrying the one line that says whether anything is in its way; and then, for the step
   * chosen, what it does to the record and every requirement it has, already answered. The
   * close-readiness route runs the firm's own registered rules read-only, so a requirement arrives
   * answered rather than being discovered by pressing the commit. The close still has the last
   * word — a balance can move between the reading and the press — and a refusal at that moment
   * re-answers the rows already on screen rather than arriving as a second kind of message.
   *
   * A REFUSED STEP IS OFFERED REFUSED. A step this account may not take, or a sample matter's every
   * step, renders as a disabled row with the reason on the row itself. A disabled control can be
   * neither hovered nor focused, so the sentence has to be readable without one.
   *
   * THE COMMIT CARRIES THE STEP'S OWN VERB — Complete Intake, Open Matter, Close Matter — because
   * that is what is about to happen. The panel's heading is the act; the commit is the step.
   *
   * WHAT IS NOT HERE. The number, the engagement and the paper file are standing facts about the
   * record rather than anything the status does, so they stay in the window that reads it
   * (matter-status-dialog.svelte). This panel holds only what bears on the change.
   */
  import { invalidateAll } from "$app/navigation";
  import * as Alert from "@magna-carta/design-system/alert";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import Badge from "@magna-carta/design-system/badge";
  import ChoiceRow from "@magna-carta/design-system/choice-row";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import StatusMark from "@magna-carta/design-system/status-mark";
  import Textarea from "@magna-carta/design-system/textarea";
  import Archive from "@lucide/svelte/icons/archive";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";
  import CircleDot from "@lucide/svelte/icons/circle-dot";
  import ClipboardCheck from "@lucide/svelte/icons/clipboard-check";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import type { ApiOutcome } from "$lib/api/request.ts";
  import type { MatterRecord } from "./matter-record.ts";
  import { matterStatusPresentation } from "./matter-status.ts";
  import {
    holdReasonRefusal,
    matterCloseRefusals,
    matterGraduateRefusals,
    matterLifecycleBlock,
    matterLifecycleSteps,
    matterOpenRefusals,
    matterStepStanding,
    MATTER_LIFECYCLE_TRANSPORT_FAILURE,
    NO_LIFECYCLE_READINESS,
    type MatterCloseRequirementState,
    type MatterLifecycleReadiness,
    type MatterLifecycleStep,
  } from "./matter-lifecycle.ts";
  import {
    closeMatter,
    graduateMatter,
    holdMatter,
    openMatter,
    readMatterCloseReadiness,
    readMatterGraduateReadiness,
    readMatterOpenReadiness,
    releaseMatter,
    reopenMatter,
    type MatterCloseNotice,
  } from "./matters-api.ts";

  let {
    matter,
    open = $bindable(false),
    subtitle,
  }: {
    matter: MatterRecord;
    /** Whether the panel is showing. Bound by the window that offers the one control opening it. */
    open?: boolean;
    /**
     * The record this acts on, named once by the window that opened it, so the panel that READS the
     * status and the panel that CHANGES it name the same matter the same way — by the newest number
     * it has drawn, not by a sentence each panel assembles for itself.
     */
    subtitle: RecordSubject;
  } = $props();

  const seal = $derived(matterStatusPresentation(matter.status));
  const steps = $derived(matterLifecycleSteps(matter.status));
  const isSample = $derived(matter.source === "sample");
  const intakeHref = $derived(`/matters/${encodeURIComponent(matter.id)}/intake`);

  // The lifecycle glyph per step. Closing wears Archive rather than a destructive glyph: the record
  // stays additive after a close, and a bin would say the file was destroyed. The pause and its
  // release wear the two transport glyphs, which is what a pause is.
  const STEP_ICON = {
    graduate: ClipboardCheck,
    open: FolderOpen,
    hold: Pause,
    release: Play,
    close: Archive,
    reopen: RotateCcw,
  };
  // A met requirement wears the product's one affirmative mark (the filled disc), so a requirement
  // that is satisfied looks exactly like a file that is clean. The other three are outline glyphs:
  // unmet is a finding, and the two kinds of no-answer wear the quiet register on purpose, because
  // a grey mark reads as "nothing said" where a red one would read as "no".
  const UNMET_ICON: Record<Exclude<MatterCloseRequirementState, "met">, typeof CircleAlert> = {
    checking: CircleDashed,
    unmet: CircleAlert,
    unknown: CircleDot,
  };
  const REQUIREMENT_TONE: Record<MatterCloseRequirementState, string> = {
    checking: "text-text-subtle",
    met: "text-status-success-subtle-foreground",
    unmet: "text-status-danger-subtle-foreground",
    unknown: "text-text-subtle",
  };

  /** Everything the rules have answered, in one record so one function can read any step's standing. */
  let readiness = $state<MatterLifecycleReadiness>(NO_LIFECYCLE_READINESS);
  /** The step the reader has chosen. Null until they do, which is what the commit's refusal says. */
  let chosen = $state<MatterLifecycleStep | null>(null);
  let holdReason = $state("");
  let holdReasonTouched = $state(false);
  const holdReasonError = $derived(holdReasonTouched ? holdReasonRefusal(holdReason) : null);
  /** The whole failure record, not a sentence squeezed out of it: the Error ID rides with it. */
  let failure = $state<StatedFailure | null>(null);
  /** The step that was taken, held so the result reads about it and not about the next one. */
  let taken = $state<MatterLifecycleStep | null>(null);
  let notices = $state<readonly MatterCloseNotice[]>([]);

  /**
   * Who is asking, from the one shared session read. Null until it lands and null again where it
   * failed; `sessionSettled` is what tells the two apart, and matterLifecycleBlock keeps a failed
   * read distinct from a permission not held.
   */
  const permissions = $derived(sessionPermissions.session?.permissions ?? null);
  const sessionSettled = $derived(sessionPermissions.settled);
  const blockOf = (candidate: MatterLifecycleStep): string | null =>
    matterLifecycleBlock({ step: candidate, isSample, sessionSettled, permissions });

  const standing = $derived(chosen === null ? null : matterStepStanding(chosen, readiness));
  const chosenBlock = $derived(chosen === null ? null : blockOf(chosen));
  const commitRefusal = $derived.by((): string | undefined => {
    if (chosen === null) return "Choose a step first.";
    if (chosenBlock !== null) return chosenBlock;
    // An unanswered question is NOT a refusal and never shuts the commit: nothing has been
    // predicted, and the step itself is the authority either way.
    if (standing?.refused === true) return "What this step requires is not met.";
    return undefined;
  });

  /*
   * The reads are made from the opening transition rather than from an effect, and that is a
   * correctness point rather than a style one: the shell calls `onOpen` from an effect of its own,
   * and a child's effects run after the parent's, so an effect guarded by a "have I asked" flag
   * would read the flag before `reset` cleared it and answer only the first opening. The rules can
   * refuse differently between two openings — money moves — so every opening asks again.
   */
  function reset(): void {
    chosen = steps.length === 1 && !isSample ? (steps[0] ?? null) : null;
    holdReason = "";
    holdReasonTouched = false;
    failure = null;
    taken = null;
    notices = [];
    readiness = NO_LIFECYCLE_READINESS;
    if (isSample) return;
    void sessionPermissions.load(fetch);
    const matterId = matter.id;
    for (const candidate of steps) {
      switch (candidate.action) {
        case "close":
          void (async () => {
            const outcome = await readMatterCloseReadiness(fetch, matterId);
            readiness =
              outcome.kind === "ok"
                ? { ...readiness, close: outcome.value }
                : { ...readiness, closeFailed: true };
          })();
          break;
        case "open":
          void (async () => {
            const outcome = await readMatterOpenReadiness(fetch, matterId);
            readiness =
              outcome.kind === "ok"
                ? { ...readiness, open: outcome.value }
                : { ...readiness, openFailed: true };
          })();
          break;
        case "graduate":
          void (async () => {
            const outcome = await readMatterGraduateReadiness(fetch, matterId);
            readiness =
              outcome.kind === "ok"
                ? { ...readiness, graduate: outcome.value }
                : { ...readiness, graduateFailed: true };
          })();
          break;
        default:
          break;
      }
    }
  }

  /**
   * The one call each step makes. A double-press must not draw a second matter number or stamp a
   * second close date, so every attempt carries its own key and the server answers a repeat with
   * the first result. Only the close answers with notices.
   */
  function perform(
    step: MatterLifecycleStep,
  ): Promise<ApiOutcome<{ matterId: string; notices?: readonly MatterCloseNotice[] }>> {
    const idempotencyKey = crypto.randomUUID();
    switch (step.action) {
      case "graduate":
        return graduateMatter(fetch, matter.id, idempotencyKey);
      case "open":
        return openMatter(fetch, matter.id, idempotencyKey);
      case "hold":
        return holdMatter(fetch, matter.id, holdReason.trim(), idempotencyKey);
      case "release":
        return releaseMatter(fetch, matter.id, idempotencyKey);
      case "close":
        return closeMatter(fetch, matter.id, idempotencyKey);
      case "reopen":
        return reopenMatter(fetch, matter.id, idempotencyKey);
    }
  }

  function report(
    attempted: MatterLifecycleStep,
    outcome: Exclude<ApiOutcome<unknown>, { kind: "ok" }>,
  ): void {
    // A step refused at the last moment is the same answer the requirements already hold, arriving
    // later: it re-answers them rather than sitting beside them, so the panel never shows two
    // accounts of what a step requires at once. Anything else is a failure, and it travels whole —
    // the Error ID and the remedy come with the record rather than being squeezed into a sentence.
    if (outcome.kind === "problem") {
      const refusedGraduation = matterGraduateRefusals(outcome.problem);
      if (refusedGraduation.length > 0) {
        readiness = {
          ...readiness,
          graduate: {
            matterId: matter.id,
            status: matter.status,
            graduable: false,
            blockers: [...refusedGraduation],
          },
          graduateFailed: false,
        };
        return;
      }
      const refusedOpen = matterOpenRefusals(outcome.problem);
      if (refusedOpen.length > 0) {
        readiness = {
          ...readiness,
          open: {
            matterId: matter.id,
            status: matter.status,
            openable: false,
            blockers: [...refusedOpen],
          },
          openFailed: false,
        };
        return;
      }
      const refusedClose = matterCloseRefusals(outcome.problem);
      if (refusedClose.length > 0) {
        readiness = {
          ...readiness,
          close: {
            matterId: matter.id,
            status: matter.status,
            closable: false,
            blockers: [...refusedClose],
          },
          closeFailed: false,
        };
        return;
      }
    }
    failure = stated(outcome.failure, attempted.failureSentence, MATTER_LIFECYCLE_TRANSPORT_FAILURE);
  }

  /**
   * Take the chosen step. The shell raises the busy state around this, closes on "committed", and
   * on "done" stands with nothing left to ask — which is what the close's advisory notices need,
   * because they exist to be read.
   */
  async function commit(): Promise<ActionOutcome> {
    const step = chosen;
    if (step === null || blockOf(step) !== null) return "refused";
    // The pause is not recorded with nothing said about why: a matter on hold that nobody can
    // explain is a matter nobody knows how to resume.
    if (step.action === "hold") {
      holdReasonTouched = true;
      if (holdReasonRefusal(holdReason) !== null) return "refused";
    }
    failure = null;
    const outcome = await perform(step);
    if (outcome.kind === "ok") {
      taken = step;
      notices = outcome.value.notices ?? [];
      // The seal behind this panel is the answer to "what happened": the re-read changes it.
      await invalidateAll();
      return notices.length > 0 ? "done" : "committed";
    }
    report(step, outcome);
    return "refused";
  }
</script>

<ActionDialog
  kind="form"
  bind:open
  heading="Change Status"
  {subtitle}
  width="wide"
  commitLabel={chosen?.label ?? "Change Status"}
  commitBusyLabel={chosen?.busyLabel}
  {commitRefusal}
  unsavedChanges={chosen?.action === "hold" && holdReason.trim().length > 0}
  onOpen={reset}
  onCommit={commit}
>
  {#snippet fields({ done })}
    {#if done && taken !== null}
      <Alert.Root variant="success">
        <Alert.Title>{taken.doneSentence}</Alert.Title>
        {#if notices.length > 0}
          <Alert.Description>
            <ul class="flex flex-col gap-4">
              {#each notices as notice (notice.code)}
                <li>{notice.message}</li>
              {/each}
            </ul>
          </Alert.Description>
        {/if}
      </Alert.Root>
    {:else}
      <div class="flex flex-col gap-16">
        <!-- Where the matter stands, stated as the fact the rest of the panel is about. -->
        <dl class="flex flex-col gap-8 text-sm">
          <div class="grid grid-cols-2 items-center gap-16">
            <dt class="text-text-muted">Status</dt>
            <dd>
              <Badge variant={seal.variant} caps>{seal.label}</Badge>
            </dd>
          </div>
        </dl>

        <!-- The steps the lifecycle allows from here, and no others. Each row carries the one line
             that says where it stands: what is in its way, or that nothing is. -->
        <div class="flex flex-col gap-8">
          <FieldLabel as="h3">Steps From Here</FieldLabel>
          <div class="flex flex-col gap-8">
            {#each steps as candidate (candidate.action)}
              {@const StepIcon = STEP_ICON[candidate.action]}
              {@const block = blockOf(candidate)}
              <ChoiceRow
                selected={candidate.action === chosen?.action}
                disabled={block !== null}
                onclick={() => {
                  chosen = candidate;
                  failure = null;
                }}
              >
                {candidate.label}
                {#snippet icon()}
                  <StepIcon class="size-16" />
                {/snippet}
                {#snippet detail()}
                  {block ?? matterStepStanding(candidate, readiness).summary}
                {/snippet}
              </ChoiceRow>
            {/each}
          </div>
        </div>

        {#if chosen !== null && standing !== null}
          <!-- The chosen step, discussed: what it does to the record, then everything it requires
               with each one already answered by the rules themselves. Not a checklist — nothing
               here is a person's to tick, and the mark states what the program found rather than
               what anybody is being asked to confirm. -->
          <div class="flex flex-col gap-8">
            <FieldLabel as="h3">{chosen.label}</FieldLabel>
            <p class="text-sm text-text-muted">{chosen.consequence}</p>
            {#if standing.requirements.length > 0}
              <ul class="flex flex-col gap-8 text-sm">
                {#each standing.requirements as requirement (requirement.key)}
                  <li class="flex items-start gap-8">
                    {#if requirement.state === "met"}
                      <!-- The word beside it says the same thing, so the mark is decoration here. -->
                      <StatusMark decorative class="mt-2 size-16" />
                    {:else}
                      {@const RequirementIcon = UNMET_ICON[requirement.state]}
                      <RequirementIcon
                        class="mt-2 size-16 shrink-0 {REQUIREMENT_TONE[requirement.state]}"
                        aria-hidden="true"
                      />
                    {/if}
                    <span class="flex flex-col gap-4">
                      <span
                        class={requirement.state === "met" ? "text-text-muted" : "text-text-default"}
                        >{requirement.label}</span
                      >
                      {#if requirement.detail !== null}
                        <span class="text-status-danger-subtle-foreground">{requirement.detail}</span
                        >
                      {/if}
                    </span>
                  </li>
                {/each}
              </ul>
            {/if}
            {#if chosen.action === "graduate"}
              <!-- Where the outstanding steps are actually answered. A requirement stated with no
                   way through to the place it is met leaves the reader hunting for it. -->
              <a
                href={intakeHref}
                class="self-start text-xs underline underline-offset-2 hover:text-text-default"
              >
                Open the Intake section
              </a>
            {/if}
            {#if chosen.action === "hold"}
              <!-- The pause's reason, asked here because this is where the pause is recorded. The
                   same field for a consultation being parked: the reason is the one thing a hold
                   carries either way. -->
              <LabelledField
                label="Reason"
                hint="Why the firm has stopped work on this matter, in a sentence. It prints beside the status; the account of it belongs on the matter's notes."
                error={holdReasonError ?? undefined}
              >
                {#snippet children({ props })}
                  <Textarea
                    {...props}
                    bind:value={holdReason}
                    rows={3}
                    onblur={() => (holdReasonTouched = true)}
                  />
                {/snippet}
              </LabelledField>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Matter Is Unchanged"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}
</ActionDialog>
