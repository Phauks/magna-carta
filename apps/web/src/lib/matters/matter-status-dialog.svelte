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
   * THE STEPS ARE SEATED ON THE STATUS, NOT AT THE FOOT OF THE WINDOW. Somebody may open this to
   * read where the file is kept, and a window whose bottom-right corner offers Close Matter puts the
   * act they did not come for exactly where a hand goes by habit. So the corner offers only the way
   * out, and each step is a quiet control beside the fact it changes, with the requirements that
   * gate it directly beneath as the reason it is disabled. An active matter offers two — the close,
   * and the pause — and a matter on hold offers its release and the close; the pause asks for its
   * reason in place, beneath the controls, rather than in a second window.
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
  import ClipboardCheck from "@lucide/svelte/icons/clipboard-check";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Hash from "@lucide/svelte/icons/hash";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
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
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import { renumberMatter, RENUMBER_MATTER_PERMISSION } from "./numbering-api.ts";
  import { matterNumberRefusal } from "./numbering-scheme.ts";
  import type { MatterRecord } from "./matter-record.ts";
  import { matterStatusPresentation } from "./matter-status.ts";
  import {
    matterCanClose,
    matterCanGraduate,
    matterCanOpen,
    matterCloseRefusals,
    matterCloseRequirements,
    matterGraduateRefusals,
    matterGraduateRequirements,
    holdReasonRefusal,
    matterLifecycleBlock,
    matterLifecycleStep,
    matterLifecycleSteps,
    matterOpenRefusals,
    matterOpenRequirements,
    MATTER_LIFECYCLE_TRANSPORT_FAILURE,
    MATTER_PHYSICAL_FILE_FACTS,
    type MatterCloseRequirementState,
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
    readSession,
    releaseMatter,
    reopenMatter,
    type MatterCloseNotice,
    type MatterCloseReadiness,
    type MatterGraduateReadiness,
    type MatterOpenReadiness,
  } from "./matters-api.ts";
  import type { ApiOutcome } from "$lib/api/request.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";

  let { matter }: { matter: MatterRecord } = $props();

  // The seal comes from the one matter-status register, so this control and the docket's status
  // column can never disagree about what "Closed" looks like.
  const seal = $derived(matterStatusPresentation(matter.status));
  /** The step the lifecycle runs toward, which is the one the readiness reads are about. */
  const step = $derived(matterLifecycleStep(matter.status));
  /** Every step this status offers, in the order they are drawn. */
  const steps = $derived(matterLifecycleSteps(matter.status));
  const offersClose = $derived(steps.some((candidate) => candidate.action === "close"));

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

  /** What the program says about opening. Null until it answers. */
  let openReadiness = $state<MatterOpenReadiness | null>(null);
  let openReadinessFailed = $state(false);

  /** What the program says about completing the intake: the steps outstanding. Null until it answers. */
  let graduateReadiness = $state<MatterGraduateReadiness | null>(null);
  let graduateReadinessFailed = $state(false);

  /** Null until the session read comes back, either way; `settled` is what tells the two apart. */
  let permissions = $state<readonly string[] | null>(null);
  let sessionSettled = $state(false);

  /**
   * The matter's number, set by hand: a court's number, a legacy number, a correction. Offered only
   * where the matter has been active (the number is drawn at open and never before), and asked in
   * place the way the hold's reason is.
   */
  let numberFormOpen = $state(false);
  let numberDraft = $state("");
  let numberTouched = $state(false);
  let numberSaving = $state(false);
  let numberFailure = $state<StatedFailure | null>(null);
  /** The server's own refusal of the number: taken by another matter, or unfit for a link. */
  let numberRefusal = $state<string | null>(null);
  const numberError = $derived(
    numberRefusal ?? (numberTouched ? matterNumberRefusal(numberDraft) : null),
  );
  /** A number belongs only to a matter that has been active; the unnumbered rungs never carry one. */
  const mayCarryNumber = $derived(matter.openedAt !== null || matter.matterNumber !== null);
  const numberBlock = $derived.by((): string | null => {
    if (!sessionSettled) return "Reading your session.";
    if (permissions === null) return null;
    return permissions.includes(RENUMBER_MATTER_PERMISSION)
      ? null
      : permissionRefusal("Setting the number", RENUMBER_MATTER_PERMISSION);
  });

  /** The pause asks for its reason in place: the field is drawn once Put On Hold is pressed. */
  let holdFormOpen = $state(false);
  let holdReason = $state("");
  let holdReasonTouched = $state(false);
  const holdReasonError = $derived(holdReasonTouched ? holdReasonRefusal(holdReason) : null);

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

  const isSample = $derived(matter.source === "sample");
  const requirements = $derived(matterCloseRequirements(readiness, readinessFailed));
  const canClose = $derived(matterCanClose(readiness));
  const openRequirements = $derived(matterOpenRequirements(openReadiness, openReadinessFailed));
  const canOpen = $derived(matterCanOpen(openReadiness));
  const graduateRequirements = $derived(
    matterGraduateRequirements(graduateReadiness, graduateReadinessFailed),
  );
  const canGraduate = $derived(matterCanGraduate(graduateReadiness));
  const intakeHref = $derived(`/matters/${encodeURIComponent(matter.id)}/intake`);
  const blockOf = (candidate: MatterLifecycleStep): string | null =>
    matterLifecycleBlock({ step: candidate, isSample, sessionSettled, permissions });
  // What is in the way of each step, stated once per distinct sentence: two steps blocked by the
  // same sample matter or the same unread session share one line, and two steps needing two
  // different permissions each get their own.
  const blockSentences = $derived([
    ...new Set(steps.map(blockOf).filter((sentence): sentence is string => sentence !== null)),
  ]);
  // A control does not offer a press whose refusal is already on the screen. An unanswered question
  // is NOT a refusal and never disables it: nothing has been predicted there, and the close is the
  // authority either way. The pause and its release have no readiness to consult: nothing gates
  // them but the permission.
  const refusedOf = (candidate: MatterLifecycleStep): boolean =>
    (candidate.action === "close" && canClose === false) ||
    (candidate.action === "open" && canOpen === false) ||
    (candidate.action === "graduate" && canGraduate === false);

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

  // Whether the matter can close, asked of the rules themselves. Only where closing is a step in
  // front of the reader, and never for a sample matter, which has no record behind it to ask about.
  let readinessAsked = false;
  $effect(() => {
    if (!open || readinessAsked || isSample || !offersClose) return;
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

  // Whether the intake can complete, asked of the firm's intake procedure itself. Only where
  // completing the intake is the step in front of the reader.
  let graduateReadinessAsked = false;
  $effect(() => {
    if (!open || graduateReadinessAsked || isSample || step.action !== "graduate") return;
    graduateReadinessAsked = true;
    const matterId = matter.id;
    void (async () => {
      const outcome = await readMatterGraduateReadiness(fetch, matterId);
      if (outcome.kind === "ok") graduateReadiness = outcome.value;
      else graduateReadinessFailed = true;
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
    holdFormOpen = false;
    holdReason = "";
    holdReasonTouched = false;
    numberFormOpen = false;
    numberDraft = "";
    numberTouched = false;
    numberFailure = null;
    numberRefusal = null;
  }

  async function setNumber(): Promise<void> {
    numberTouched = true;
    numberRefusal = null;
    if (numberSaving || matterNumberRefusal(numberDraft) !== null) return;
    numberSaving = true;
    numberFailure = null;
    const outcome = await renumberMatter(fetch, matter.id, numberDraft.trim(), crypto.randomUUID());
    numberSaving = false;
    if (outcome.kind === "ok") {
      numberFormOpen = false;
      numberDraft = "";
      numberTouched = false;
      await invalidateAll();
      return;
    }
    // The two refusals a person can act on read beside the field; anything else is a failure and
    // travels whole, with its Error ID.
    if (outcome.kind === "problem" && outcome.problem.status === 409) {
      numberRefusal = "Another matter already wears that number.";
      return;
    }
    if (outcome.kind === "problem" && outcome.problem.status === 422) {
      numberRefusal = outcome.problem.detail ?? "That number cannot be used.";
      return;
    }
    numberFailure = stated(
      outcome.failure,
      "The number was not set.",
      "Nothing answered. The matter's number is unchanged.",
    );
  }

  function report(
    attempted: MatterLifecycleStep,
    outcome: Exclude<ApiOutcome<unknown>, { kind: "ok" }>,
  ): void {
    // A close refused at the last moment is the same answer the requirements already hold, arriving
    // later: it re-answers them rather than sitting beside them, so the window never shows two
    // accounts of what closing requires at once. Anything else is a failure, and it travels whole —
    // the Error ID and the remedy come with the record rather than being squeezed into a sentence.
    if (outcome.kind === "problem") {
      const refusedGraduation = matterGraduateRefusals(outcome.problem);
      if (refusedGraduation.length > 0) {
        graduateReadiness = {
          matterId: matter.id,
          status: matter.status,
          graduable: false,
          blockers: [...refusedGraduation],
        };
        graduateReadinessFailed = false;
        return;
      }
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
    failure = stated(outcome.failure, attempted.failureSentence, MATTER_LIFECYCLE_TRANSPORT_FAILURE);
  }

  // The matter behind the chrome is re-read rather than guessed at: reopen restores open OR
  // consultation, and only the server knows which, so every step settles the same way.
  async function settle(completed: MatterLifecycleStep): Promise<void> {
    taken = completed;
    // A step with nothing to report dismisses itself: the answer to "what happened" is the seal
    // behind the window, which the re-read is about to change. The window stays only where the
    // close raised advisory notices, because those exist to be read.
    if (notices.length === 0) open = false;
    await invalidateAll();
  }

  async function take(completed: MatterLifecycleStep): Promise<void> {
    if (working || blockOf(completed) !== null || refusedOf(completed)) return;
    // The pause asks for its reason first. The first press opens the field; the field's own commit
    // is what records the hold, so a hold is never recorded with nothing said about why.
    if (completed.action === "hold" && !holdFormOpen) {
      holdFormOpen = true;
      return;
    }
    if (completed.action === "hold") {
      holdReasonTouched = true;
      if (holdReasonRefusal(holdReason) !== null) return;
    }
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
      report(completed, outcome);
      return;
    }
    const outcome =
      completed.action === "graduate"
        ? await graduateMatter(fetch, matter.id, idempotencyKey)
        : completed.action === "open"
          ? await openMatter(fetch, matter.id, idempotencyKey)
          : completed.action === "hold"
            ? await holdMatter(fetch, matter.id, holdReason.trim(), idempotencyKey)
            : completed.action === "release"
              ? await releaseMatter(fetch, matter.id, idempotencyKey)
              : await reopenMatter(fetch, matter.id, idempotencyKey);
    working = false;
    if (outcome.kind === "ok") {
      await settle(completed);
      return;
    }
    report(completed, outcome);
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
    {matter.matterNumber !== null
      ? `Matter ${matter.matterNumber}`
      : matter.consultationNumber !== null
        ? `Consultation ${matter.consultationNumber}`
        : seal.label} ·
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
            {#each steps as candidate (candidate.action)}
              {@const StepIcon = STEP_ICON[candidate.action]}
              {@const candidateBlock = blockOf(candidate)}
              <Button
                variant="secondary"
                size="sm"
                disabled={candidateBlock !== null || refusedOf(candidate) || working}
                title={candidateBlock ?? undefined}
                aria-describedby={candidateBlock === null ? undefined : blockedDescriptionIdentifier}
                aria-expanded={candidate.action === "hold" ? holdFormOpen : undefined}
                onclick={() => void take(candidate)}
              >
                <StepIcon class="size-16" aria-hidden="true" />
                {working && taken === null ? candidate.busyLabel : candidate.label}
              </Button>
            {/each}
          </dd>
        </div>
      </dl>

      <!-- What is in the way gets its own line: a disabled control can be neither hovered nor
           focused, so the sentence has to be readable on the screen. -->
      {#if blockSentences.length > 0}
        <div id={blockedDescriptionIdentifier} class="flex flex-col gap-4">
          {#each blockSentences as sentence (sentence)}
            <p class="text-xs text-text-subtle">{sentence}</p>
          {/each}
        </div>
      {/if}

      {#if matter.status === "hold"}
        <!-- The pause, as the record states it: when it began, and why, in the words whoever
             recorded it used. Read before anything else on a held matter, because it is the
             reason the reader is looking at this window. -->
        <div class="flex flex-col gap-8">
          <FieldLabel as="h3">On Hold</FieldLabel>
          <dl class="flex flex-col gap-8 text-sm">
            <div class="grid grid-cols-2 items-baseline gap-16">
              <dt class="text-text-muted">Since</dt>
              <dd class="tabular-nums">
                {matter.heldAt === null ? "Not recorded" : formatDate(matter.heldAt)}
              </dd>
            </div>
            <div class="grid grid-cols-2 items-baseline gap-16">
              <dt class="text-text-muted">Reason</dt>
              <dd>{matter.holdReason ?? "Not recorded"}</dd>
            </div>
          </dl>
        </div>
      {/if}

      <!-- The matter's number, and the way to set one by hand. A standing fact rather than a
           step: it is drawn when the matter opens and sits here so a court's number or a legacy
           number can be put on the record without leaving the window that states the status. -->
      <div class="flex flex-col gap-8">
        <FieldLabel as="h3">Number</FieldLabel>
        <dl class="flex flex-col gap-8 text-sm">
          <div class="grid grid-cols-2 items-center gap-16">
            <dt class="text-text-muted">Matter Number</dt>
            <dd class="flex flex-wrap items-center gap-8">
              {#if matter.matterNumber !== null}
                <span class="tabular-nums">{matter.matterNumber}</span>
              {:else}
                <span class="text-text-subtle">
                  {mayCarryNumber ? "Not recorded" : "Drawn when the matter opens"}
                </span>
              {/if}
              {#if mayCarryNumber && !isSample}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={numberBlock !== null || numberSaving}
                  title={numberBlock ?? undefined}
                  aria-expanded={numberFormOpen}
                  onclick={() => {
                    numberFormOpen = !numberFormOpen;
                    numberRefusal = null;
                  }}
                >
                  <Hash class="size-16" aria-hidden="true" />
                  {matter.matterNumber === null ? "Set Number" : "Change Number"}
                </Button>
              {/if}
            </dd>
          </div>
          {#if matter.consultationNumber !== null}
            <div class="grid grid-cols-2 items-center gap-16">
              <dt class="text-text-muted">Consultation Number</dt>
              <dd class="tabular-nums">{matter.consultationNumber}</dd>
            </div>
          {/if}
        </dl>
        {#if mayCarryNumber && !isSample && numberBlock !== null}
          <p class="text-xs text-text-subtle">{numberBlock}</p>
        {/if}
        {#if numberFormOpen}
          <LabelledField
            label={matter.matterNumber === null ? "Matter Number" : "New Matter Number"}
            hint="A court's number, a number from the firm's old system, or a correction. It has to be unique in the firm and able to stand in a link; the number it replaces stays on the record."
            error={numberError ?? undefined}
          >
            {#snippet children({ props })}
              <Input
                {...props}
                bind:value={numberDraft}
                disabled={numberSaving}
                onblur={() => (numberTouched = true)}
                onkeydown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void setNumber();
                  }
                }}
              />
            {/snippet}
          </LabelledField>
          {#if numberFailure !== null}
            <FailureNotice
              failure={numberFailure.failure}
              title="The Number Was Not Set"
              fallback={numberFailure.fallback}
              whenSilent={numberFailure.whenSilent}
            />
          {/if}
          <div class="flex flex-wrap items-center gap-8">
            <Button variant="primary" size="sm" disabled={numberSaving} onclick={() => void setNumber()}>
              <Hash class="size-16" aria-hidden="true" />
              {numberSaving ? "Setting" : matter.matterNumber === null ? "Set Number" : "Change Number"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={numberSaving}
              onclick={() => {
                numberFormOpen = false;
                numberDraft = "";
                numberTouched = false;
                numberRefusal = null;
              }}
            >
              Cancel
            </Button>
          </div>
        {/if}
      </div>

      {#if holdFormOpen && matter.status === "open"}
        <!-- The pause's reason, asked in place. Required, because a matter on hold with nothing
             said about why is a matter nobody knows how to resume. -->
        <div class="flex flex-col gap-8">
          <FieldLabel as="h3">Put On Hold</FieldLabel>
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
                disabled={working}
                onblur={() => (holdReasonTouched = true)}
              />
            {/snippet}
          </LabelledField>
          <div class="flex flex-wrap items-center gap-8">
            <Button
              variant="primary"
              size="sm"
              disabled={working}
              onclick={() => void take(steps.find((candidate) => candidate.action === "hold") ?? step)}
            >
              <Pause class="size-16" aria-hidden="true" />
              {working ? "Holding" : "Put On Hold"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={working}
              onclick={() => {
                holdFormOpen = false;
                holdReason = "";
                holdReasonTouched = false;
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
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

      {#if step.action === "graduate" && !isSample}
        <!-- What completing the intake requires: the firm's own intake procedure, each required
             step that has no satisfying answer, in the words of whoever should answer it. The rows
             are the refusals themselves — there is no fixed roster to state as met, because what an
             intake must clear is the firm's to write and may be nothing at all. -->
        <div class="flex flex-col gap-8">
          <FieldLabel as="h3">Requirements To Complete Intake</FieldLabel>
          {#if graduateReadiness === null && !graduateReadinessFailed}
            <p class="text-xs text-text-subtle">Reading the intake procedure.</p>
          {:else if graduateReadinessFailed}
            <p class="text-xs text-text-subtle">
              These could not be checked, so completing the intake will check them.
            </p>
          {:else if graduateRequirements.length === 0}
            <p class="flex items-center gap-8 text-sm text-text-muted">
              <StatusMark decorative class="size-16" />
              Every required intake step is answered.
            </p>
          {:else}
            <ul class="flex flex-col gap-8 text-sm">
              {#each graduateRequirements as requirement (requirement.key)}
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

      {#if step.action === "open" && !isSample && openRequirements.length > 0}
        <!-- Opening has no roster of its own now that the procedure gates the intake; the block is
             drawn only when the open itself refused with reasons, so they can be read where the
             control is. -->
        <div class="flex flex-col gap-8">
          <FieldLabel as="h3">Requirements To Open</FieldLabel>
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
        </div>
      {/if}

      {#if offersClose && !isSample}
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
