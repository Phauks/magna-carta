<script lang="ts">
  /*
   * The status seal, and the window behind it. A matter's status is changed HERE, by pressing the
   * status itself.
   *
   * WHY THE SEAL IS THE CONTROL. The status is the fact the top-left corner of a matter exists to
   * state, and it is the only thing on the masthead a person changes rather than edits. Putting the
   * change behind an overflow menu made the two strangers: you read the status in one place and
   * changed it in another, three gestures away.
   *
   * WHAT THE WINDOW IS AND IS NOT. It is a short answer to four questions and nothing else: what
   * the status is, how the matter is engaged — the agreement the client signed and the fee
   * arrangement it rests on — what closing requires and whether each requirement is met, and where
   * the firm's paper file is kept. It is NOT a description of what closing does, NOT a checklist
   * for a person to work through, and NOT a summary of the matter — everything else about the
   * matter is on the sections that own it.
   *
   * THE ENGAGEMENT LIVES HERE AND NOT ON THE FEES SCREEN (owner ruling, 2026-09-03). The fee
   * arrangement is a fact of the engagement, set when the matter opens and rarely read again, and
   * the intake agreement it rests on is the same kind of fact as the paper file's whereabouts. So
   * it sits with the status, its version history folded away, and Amend seated beside it the way
   * the lifecycle step is seated beside the status. The Fees screen states nothing about it.
   *
   * THE STEP IS SEATED ON THE STATUS, NOT AT THE FOOT OF THE WINDOW. Somebody may open this to read
   * where the file is kept, and a window whose bottom-right corner offers Close Matter puts the act
   * they did not come for exactly where a hand goes by habit. So the corner offers only the way out,
   * and the step is a quiet control beside the fact it changes, with the requirements that gate it
   * directly beneath as the reason it is disabled.
   *
   * IT IS A READING PANEL, AND THE SHELL SAYS SO. It opens in ActionDialog with `kind="reading"`,
   * which is the kind that asks for nothing: its action bar ends at the way out, and any step it
   * offers is seated in its body beside the fact the step changes. That kind exists because THIS
   * window refused a footer commit for the reason above before the shell had a word for it.
   *
   * TWO SIDES, AND THE DIVISION IS THE POINT. The left is the matter's status and the step it
   * offers; the right is the paper file. They are apart because the paper file is a STANDING fact
   * and not a consequence of the step: a firm keeps a matter's folder in a box, commonly with other
   * matters' folders and commonly at a remote store, and closing the matter moves none of that. Laid
   * out under the requirements it would read as what closing does to the file, which is the one
   * thing it must not say. The right side is the shell's context pane — the record window's own
   * right pane, lent — so it sits on the quieter surface behind a hairline, as context does
   * everywhere in the product.
   *
   * THE PROGRAM ANSWERS THE REQUIREMENTS. The close-readiness route runs the firm's own registered
   * rules read-only, so each requirement arrives already answered rather than being discovered by
   * pressing the button. An unmet one carries the rule's own sentence, which names the amount, where
   * it sits, and the movements that clear it. The close still has the last word: a balance can move
   * between the reading and the press, which is what the close's own commit guards are for, and a
   * refusal at that moment re-answers the requirements already on screen rather than arriving as a
   * second kind of message.
   */
  import { invalidateAll } from "$app/navigation";
  import * as Alert from "@magna-carta/design-system/alert";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Archive from "@lucide/svelte/icons/archive";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";
  import CircleDot from "@lucide/svelte/icons/circle-dot";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import StatusMark from "@magna-carta/design-system/status-mark";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import AmendAgreementDialog from "$lib/billing/amend-agreement-dialog.svelte";
  import {
    BILLING_PERMISSIONS,
    readArrangement,
    type ArrangementRecord,
  } from "$lib/billing/billing-api.ts";
  import {
    ARRANGEMENT_KIND_LABELS,
    arrangementTerms,
    versionPeriod,
    versionTitle,
  } from "$lib/billing/fee-agreement.ts";
  import { fileDownloadUrl } from "$lib/file-manager/matter-file-api.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { MaturityBadge } from "@magna-carta/design-system/maturity";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import type { MatterRecord } from "./matter-record.ts";
  import { matterStatusPresentation } from "./matter-status.ts";
  import {
    matterCanClose,
    matterCanOpen,
    matterCloseRefusals,
    matterCloseRequirements,
    matterLifecycleBlock,
    matterLifecycleStep,
    matterOpenRefusals,
    matterOpenRequirements,
    MATTER_LIFECYCLE_TRANSPORT_FAILURE,
    MATTER_PHYSICAL_FILE_FACTS,
    type MatterCloseRequirementState,
    type MatterLifecycleStep,
  } from "./matter-lifecycle.ts";
  import {
    closeMatter,
    openMatter,
    readMatterCloseReadiness,
    readMatterOpenReadiness,
    readSession,
    reopenMatter,
    type MatterCloseNotice,
    type MatterCloseReadiness,
    type MatterOpenReadiness,
  } from "./matters-api.ts";
  import type { ApiOutcome } from "$lib/api/request.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";

  let { matter }: { matter: MatterRecord } = $props();

  // The seal comes from the one matter-status register, so this control and the docket's status
  // column can never disagree about what "Closed" looks like.
  const seal = $derived(matterStatusPresentation(matter.status));
  const step = $derived(matterLifecycleStep(matter.status));

  // The lifecycle glyph per step. Closing wears Archive rather than a destructive glyph: the record
  // stays additive after a close, and a bin would say the file was destroyed.
  const STEP_ICON = { open: FolderOpen, close: Archive, reopen: RotateCcw };
  // A met requirement wears the product's one affirmative mark (StatusMark, the filled disc), so a
  // requirement that is satisfied looks exactly like a file that is clean. The other three are
  // outline glyphs: unmet is a finding, and the two kinds of no-answer wear the quiet register on
  // purpose, because a grey mark reads as "nothing said" where a red one would read as "no".
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

  let open = $state(false);
  let working = $state(false);
  /** The step that was taken, held so the result reads about it and not about the next one. */
  let taken = $state<MatterLifecycleStep | null>(null);
  let notices = $state<readonly MatterCloseNotice[]>([]);
  /** The whole failure record, not a sentence squeezed out of it: the Error ID rides with it. */
  let failure = $state<StatedFailure | null>(null);

  /** What the program says about closing. Null until the read comes back. */
  let readiness = $state<MatterCloseReadiness | null>(null);
  let readinessFailed = $state(false);

  /** What the program says about opening: the intake steps outstanding. Null until it answers. */
  let openReadiness = $state<MatterOpenReadiness | null>(null);
  let openReadinessFailed = $state(false);

  /** Null until the session read comes back, either way; `settled` is what tells the two apart. */
  let permissions = $state<readonly string[] | null>(null);
  let sessionSettled = $state(false);

  /** The engagement: the fee arrangement in force and its history. Null until the read comes back. */
  let arrangement = $state<ArrangementRecord | null>(null);
  let arrangementFailed = $state(false);
  let arrangementAsked = false;
  let historyShown = $state(false);
  let amendOpen = $state(false);

  const inForce = $derived(arrangement?.inForce ?? null);
  const history = $derived(arrangement?.history ?? []);
  const currency = $derived(inForce?.currency ?? "USD");
  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });
  const mayAmend = $derived(
    permissions === null || permissions.includes(BILLING_PERMISSIONS.configure),
  );
  const AMEND_REFUSAL = permissionRefusal("Amending the fee arrangement", BILLING_PERMISSIONS.configure);

  const identifier = $props.id();
  const blockedDescriptionIdentifier = `${identifier}-blocked`;

  const StepIcon = $derived(STEP_ICON[step.action]);
  const isSample = $derived(matter.source === "sample");
  const requirements = $derived(matterCloseRequirements(readiness, readinessFailed));
  const canClose = $derived(matterCanClose(readiness));
  const openRequirements = $derived(matterOpenRequirements(openReadiness, openReadinessFailed));
  const canOpen = $derived(matterCanOpen(openReadiness));
  const intakeHref = $derived(`/matters/${encodeURIComponent(matter.id)}/intake`);
  const block = $derived(matterLifecycleBlock({ step, isSample, sessionSettled, permissions }));
  // A control does not offer a press whose refusal is already on the screen. An unanswered question
  // is NOT a refusal and never disables it: nothing has been predicted there, and the close is the
  // authority either way.
  const refused = $derived(
    (step.action === "close" && canClose === false) ||
      (step.action === "open" && canOpen === false),
  );

  // Who is asking, read once and only when somebody actually opens the window. Every matter page in
  // the app would otherwise pay for a request that only this control uses. A sample matter is
  // already blocked for a better reason, so it never asks at all.
  $effect(() => {
    if (!open || sessionSettled || isSample) return;
    void (async () => {
      const outcome = await readSession(fetch);
      permissions = outcome.kind === "ok" ? outcome.value.permissions : null;
      sessionSettled = true;
    })();
  });

  // Whether the matter can close, asked of the rules themselves. Only where closing is the step in
  // front of the reader, and never for a sample matter, which has no record behind it to ask about.
  let readinessAsked = false;
  $effect(() => {
    if (!open || readinessAsked || isSample || step.action !== "close") return;
    readinessAsked = true;
    const matterId = matter.id;
    void (async () => {
      const outcome = await readMatterCloseReadiness(fetch, matterId);
      if (outcome.kind === "ok") readiness = outcome.value;
      else readinessFailed = true;
    })();
  });

  // Whether the consultation can open, asked of the opening rules themselves — the firm's intake
  // procedure. Only where opening is the step in front of the reader.
  let openReadinessAsked = false;
  $effect(() => {
    if (!open || openReadinessAsked || isSample || step.action !== "open") return;
    openReadinessAsked = true;
    const matterId = matter.id;
    void (async () => {
      const outcome = await readMatterOpenReadiness(fetch, matterId);
      if (outcome.kind === "ok") openReadiness = outcome.value;
      else openReadinessFailed = true;
    })();
  });

  // The engagement is read when the window opens, every time: an amendment recorded elsewhere
  // between two openings must not leave this window stating the old deal.
  $effect(() => {
    if (!open || arrangementAsked || isSample) return;
    arrangementAsked = true;
    const matterId = matter.id;
    void (async () => {
      const outcome = await readArrangement(fetch, matterId);
      if (outcome.kind === "ok") {
        arrangement = outcome.value;
        arrangementFailed = false;
      } else {
        arrangementFailed = true;
      }
    })();
  });

  // A window opened again starts on the step, not on the last answer it gave.
  function reset(): void {
    taken = null;
    notices = [];
    failure = null;
    arrangementAsked = false;
    historyShown = false;
  }

  function report(outcome: Exclude<ApiOutcome<unknown>, { kind: "ok" }>): void {
    // A close refused at the last moment is the same answer the requirements already hold, arriving
    // later: it re-answers them rather than sitting beside them, so the window never shows two
    // accounts of what closing requires at once. Anything else is a failure, and it travels whole —
    // the Error ID and the remedy come with the record rather than being squeezed into a sentence.
    if (outcome.kind === "problem") {
      const refusedOpen = matterOpenRefusals(outcome.problem);
      if (refusedOpen.length > 0) {
        openReadiness = {
          matterId: matter.id,
          status: matter.status,
          openable: false,
          blockers: [...refusedOpen],
        };
        openReadinessFailed = false;
        return;
      }
      const refusedClose = matterCloseRefusals(outcome.problem);
      if (refusedClose.length > 0) {
        readiness = {
          matterId: matter.id,
          status: matter.status,
          closable: false,
          blockers: [...refusedClose],
        };
        readinessFailed = false;
        return;
      }
    }
    failure = stated(outcome.failure, step.failureSentence, MATTER_LIFECYCLE_TRANSPORT_FAILURE);
  }

  // The matter behind the chrome is re-read rather than guessed at: reopen restores open OR
  // prospective, and only the server knows which, so every step settles the same way.
  async function settle(completed: MatterLifecycleStep): Promise<void> {
    taken = completed;
    // A step with nothing to report dismisses itself: the answer to "what happened" is the seal
    // behind the window, which the re-read is about to change. The window stays only where the
    // close raised advisory notices, because those exist to be read.
    if (notices.length === 0) open = false;
    await invalidateAll();
  }

  async function take(): Promise<void> {
    if (working || block !== null || refused) return;
    const completed = step;
    working = true;
    failure = null;
    // A double-press must not draw a second matter number or stamp a second close date, so every
    // attempt carries its own key and the server answers a repeat with the first result.
    const idempotencyKey = crypto.randomUUID();
    if (completed.action === "close") {
      const outcome = await closeMatter(fetch, matter.id, idempotencyKey);
      working = false;
      if (outcome.kind === "ok") {
        notices = outcome.value.notices;
        await settle(completed);
        return;
      }
      report(outcome);
      return;
    }
    const outcome =
      completed.action === "open"
        ? await openMatter(fetch, matter.id, idempotencyKey)
        : await reopenMatter(fetch, matter.id, idempotencyKey);
    working = false;
    if (outcome.kind === "ok") {
      await settle(completed);
      return;
    }
    report(outcome);
  }
</script>

<!-- The seal is a real button around the chip, never a chip pretending to be one: a Badge labels
     and does not act. The affordance rides the hairline the badge recipe already reserves and
     leaves transparent, so it costs no layout: the pill is outlined at rest (a control has to
     read as one before it is hovered, which is what the overflow button beside it had to learn)
     and the edge strengthens under the pointer. It matters most in dark mode, where the neutral
     Closed chip's tint is all but the page's own ground and the word alone would read as text. -->
<button
  type="button"
  class="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
  aria-label="Matter status: {seal.label}"
  aria-haspopup="dialog"
  aria-expanded={open}
  title={seal.meaning}
  onclick={() => (open = true)}
>
  <Badge variant={seal.variant} class="border-border-default hover:border-border-strong" caps>
    {seal.label}
  </Badge>
</button>

<!-- The firm's wide working window, not a confirmation's width. The left side is bounded and
     always will be; the right side is a panel that grows into a real physical-file register, and
     a surface sized to today's sparse version would have to be resized the day it arrives. The
     structure that will hold the work renders at rest. While a step's result is on screen the
     window narrows to it: the file is not what that answer is about. -->
<ActionDialog
  kind="reading"
  bind:open
  heading="Matter Status"
  width="record"
  context={taken === null ? physicalFile : undefined}
  onOpen={reset}
>
  {#snippet subtitle()}
    {matter.matterNumber === null ? "Consultation" : `Matter ${matter.matterNumber}`} ·
    {matter.title}
  {/snippet}

  {#snippet fields()}
    {#if taken === null}
      <!-- The matter's status and the step it offers. -->
      <div class="flex flex-col gap-16">
      <dl class="flex flex-col gap-8 text-sm">
        <div class="grid grid-cols-2 items-center gap-16">
          <dt class="text-text-muted">Status</dt>
          <!-- The step sits on the status, not at the foot of the window. A window somebody
               opened to read the file's whereabouts should not carry the close as the thing its
               bottom-right corner offers: that is where a screen puts the act it was opened for,
               and this one was not necessarily opened for that. Seated here it is quiet, it is
               beside the fact it changes, and the requirements that gate it read as the reason
               it is disabled rather than as a paragraph somewhere above a button. -->
          <dd class="flex flex-wrap items-center gap-8">
            <Badge variant={seal.variant} caps>
              {seal.label}
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              disabled={block !== null || refused || working}
              title={block ?? undefined}
              aria-describedby={block === null ? undefined : blockedDescriptionIdentifier}
              onclick={take}
            >
              <StepIcon class="size-16" aria-hidden="true" />
              {working ? step.busyLabel : step.label}
            </Button>
          </dd>
        </div>
      </dl>

      <!-- What is in the way gets its own line: a disabled control can be neither hovered nor
           focused, so the sentence has to be readable on the screen. -->
      {#if block !== null}
        <p id={blockedDescriptionIdentifier} class="text-xs text-text-subtle">{block}</p>
      {/if}

      {#if !isSample}
        <!-- How the matter is engaged: the agreement the client signed, and the fee arrangement it
             rests on. Amend is seated beside the arrangement as the step is seated beside the
             status; the history is folded away because it is rarely read and never short. -->
        <div class="flex flex-col gap-8">
          <FieldLabel as="h3">Engagement</FieldLabel>
          {#if arrangement === null && !arrangementFailed}
            <p class="text-xs text-text-subtle">Reading the agreement.</p>
          {:else if arrangementFailed}
            <p class="text-xs text-text-subtle">The agreement could not be read.</p>
          {:else}
            <dl class="flex flex-col gap-8 text-sm">
              <div class="grid grid-cols-2 items-center gap-16">
                <dt class="text-text-muted">Agreement</dt>
                <dd>
                  {#if inForce?.agreementFileId != null && inForce.agreementFileName !== null}
                    <a
                      href={fileDownloadUrl(inForce.agreementFileId)}
                      class="underline underline-offset-2 hover:text-text-default"
                      title="The signed agreement, from the matter's files"
                    >
                      {inForce.agreementFileName}
                    </a>
                  {:else if inForce?.agreementFileId != null}
                    <span class="text-text-subtle">The file named on this version has been deleted.</span>
                  {:else}
                    <span class="text-text-subtle">Not on file</span>
                  {/if}
                </dd>
              </div>
              <div class="grid grid-cols-2 items-center gap-16">
                <dt class="text-text-muted">Billed As</dt>
                <dd class="flex flex-wrap items-center gap-8">
                  <span>
                    {inForce === null ? ARRANGEMENT_KIND_LABELS.hourly : ARRANGEMENT_KIND_LABELS[inForce.kind]}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!mayAmend}
                    title={mayAmend
                      ? "Record an amendment as a new version. The version in force stays on the record with the dates it governed."
                      : AMEND_REFUSAL}
                    onclick={() => (amendOpen = true)}
                  >
                    <SquarePen class="size-16" aria-hidden="true" />
                    Amend
                  </Button>
                </dd>
              </div>
              {#if inForce === null}
                <p class="text-xs text-text-subtle">
                  Nothing was recorded, and a matter with no arrangement is billed hourly.
                </p>
              {:else}
                <div class="grid grid-cols-2 items-baseline gap-16">
                  <dt class="text-text-muted">Terms</dt>
                  <dd>{arrangementTerms(inForce, money)}</dd>
                </div>
                <div class="grid grid-cols-2 items-baseline gap-16">
                  <dt class="text-text-muted">In Force Since</dt>
                  <dd class="tabular-nums">
                    {formatDate(inForce.validFrom)} · version {inForce.version} of {history.length}
                  </dd>
                </div>
              {/if}
            </dl>
            {#if history.length > 1}
              <Button
                variant="ghost"
                size="sm"
                class="self-start"
                aria-expanded={historyShown}
                onclick={() => (historyShown = !historyShown)}
              >
                {#if historyShown}
                  <ChevronDown class="size-16" aria-hidden="true" />
                {:else}
                  <ChevronRight class="size-16" aria-hidden="true" />
                {/if}
                {historyShown ? "Hide the earlier versions" : `Show the ${history.length - 1} earlier ${history.length === 2 ? "version" : "versions"}`}
              </Button>
              {#if historyShown}
                <ul class="flex flex-col gap-8 text-sm">
                  {#each history as version (version.id)}
                    <li class="flex flex-col gap-4">
                      <span class="flex items-baseline justify-between gap-16">
                        <span>{versionTitle(version)}</span>
                        <span class="text-xs text-text-muted tabular-nums">
                          {versionPeriod(version, formatDate)}
                        </span>
                      </span>
                      <span class="text-xs text-text-subtle">{arrangementTerms(version, money)}</span>
                      {#if version.agreementFileName !== null && version.agreementFileId !== null}
                        <a
                          href={fileDownloadUrl(version.agreementFileId)}
                          class="self-start text-xs underline underline-offset-2"
                        >
                          {version.agreementFileName}
                        </a>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          {/if}
        </div>
      {/if}

      {#if step.action === "open" && !isSample}
        <!-- What opening requires: the firm's own intake procedure, each required step that has no
             satisfying answer, in the words of whoever should answer it. The rows are the refusals
             themselves — there is no fixed roster to state as met, because what a consultation must
             clear is the firm's to write and may be nothing at all. -->
        <div class="flex flex-col gap-8">
          <FieldLabel as="h3">Requirements To Open</FieldLabel>
          {#if openReadiness === null && !openReadinessFailed}
            <p class="text-xs text-text-subtle">Reading the intake procedure.</p>
          {:else if openReadinessFailed}
            <p class="text-xs text-text-subtle">
              These could not be checked, so the open will check them.
            </p>
          {:else if openRequirements.length === 0}
            <p class="flex items-center gap-8 text-sm text-text-muted">
              <StatusMark decorative class="size-16" />
              Every required intake step is answered.
            </p>
          {:else}
            <ul class="flex flex-col gap-8 text-sm">
              {#each openRequirements as requirement (requirement.key)}
                <li class="flex items-start gap-8">
                  <CircleAlert
                    class="mt-2 size-16 shrink-0 {REQUIREMENT_TONE.unmet}"
                    aria-hidden="true"
                  />
                  <span class="text-text-default">{requirement.label}</span>
                </li>
              {/each}
            </ul>
          {/if}
          <a
            href={intakeHref}
            class="self-start text-xs underline underline-offset-2 hover:text-text-default"
          >
            Open the Intake section
          </a>
        </div>
      {/if}

      {#if step.action === "close" && !isSample}
        <!-- What closing requires, each one already answered by the rules themselves. Not a
             checklist: nothing here is a person's to tick, and the mark states what the program
             found rather than what anybody is being asked to confirm. -->
        <div class="flex flex-col gap-8">
          <FieldLabel as="h3">Requirements To Close</FieldLabel>
          <ul class="flex flex-col gap-8 text-sm">
            {#each requirements as requirement (requirement.key)}
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
                    <span class="text-status-danger-subtle-foreground"
                      >{requirement.detail}</span
                    >
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
          {#if readinessFailed}
            <!-- Unanswered is not unmet, and the difference is the whole reason for this line. -->
            <p class="text-xs text-text-subtle">
              These could not be checked, so the close will check them.
            </p>
          {/if}
        </div>
      {/if}
      </div>
    {:else}
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

<!-- Amending is its own act, asked in its own panel over this one; the answer comes back here. -->
<AmendAgreementDialog
  bind:open={amendOpen}
  {arrangement}
  matterId={matter.id}
  onRecorded={(record) => (arrangement = record)}
/>

<!-- The paper file, which the step does not touch. -->
{#snippet physicalFile()}
  <div class="flex flex-col gap-8">
    <FieldLabel as="h3">Physical File</FieldLabel>
    <!-- The firm's own paper file, which is not the custody register: that one holds client
         property left with the firm to guard. Nothing here is served yet, and the rows say so
         the way a row says it — "Not recorded" beside the Soon mark. There is deliberately no
         sentence under them naming the dependency: a row that already states it holds nothing
         and wears the Soon mark has said it, and a paragraph repeating it was the loudest copy
         on the window (owner ruling). The reasoning lives in matter-lifecycle.ts. -->
    <dl class="flex flex-col gap-8 text-sm">
      {#each MATTER_PHYSICAL_FILE_FACTS as fact (fact.key)}
        <div class="grid grid-cols-2 items-baseline gap-16">
          <dt class="text-text-muted">{fact.label}</dt>
          <dd class="flex items-center gap-8 text-text-subtle">
            Not recorded
            <MaturityBadge stage="soon" />
          </dd>
        </div>
      {/each}
    </dl>
  </div>
{/snippet}
