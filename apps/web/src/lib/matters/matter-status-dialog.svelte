<script lang="ts">
  /*
   * The status seal, and the window behind it. Changing a matter's status is done HERE, by pressing
   * the standing itself.
   *
   * WHY THE SEAL IS THE CONTROL. The status is the fact the top-left corner of a matter exists to
   * state, and it is the only thing on the masthead a person changes rather than edits. Putting the
   * change behind an overflow menu made the two strangers: you read the standing in one place and
   * changed it in another, three gestures away.
   *
   * WHAT THE WINDOW IS AND IS NOT. It is a short answer to three questions and nothing else: what
   * the standing is, whether the matter can close, and what becomes of the paper file. It is NOT a
   * description of what closing does, NOT a checklist for a person to work through, and NOT a
   * summary of the matter — closing changes a standing and stamps a date, and everything else about
   * the matter is on the sections that own it.
   *
   * THE PROGRAM ANSWERS "CAN THIS CLOSE", NOT THE READER. The close-readiness route runs the firm's
   * own registered rules read-only, so the verdict is on screen before the button is pressed rather
   * than discovered by pressing it. A No carries the rules' own sentences, which name the amount,
   * where it sits, and the movements that clear it. The close still has the last word: the balance
   * can move between the reading and the press, which is what the close's own commit guards are for,
   * and a refusal at that moment lands in the same place as the verdict rather than as a second
   * kind of message.
   */
  import { invalidateAll } from "$app/navigation";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Archive from "@lucide/svelte/icons/archive";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import type { MatterRecord } from "./matter-record.ts";
  import { matterStatusPresentation } from "./matter-status.ts";
  import {
    matterCloseRefusals,
    matterCloseStanding,
    matterLifecycleBlock,
    matterLifecycleStep,
    MATTER_LIFECYCLE_TRANSPORT_FAILURE,
    MATTER_PHYSICAL_FILE_FACTS,
    type MatterCloseVerdict,
    type MatterLifecycleStep,
  } from "./matter-lifecycle.ts";
  import {
    closeMatter,
    openMatter,
    readMatterCloseReadiness,
    readSession,
    reopenMatter,
    type MatterCloseNotice,
    type MatterCloseReadiness,
  } from "./matters-api.ts";
  import type { ApiOutcome } from "$lib/api/request.ts";

  let { matter }: { matter: MatterRecord } = $props();

  // The seal comes from the one matter-status register, so this control and the docket's status
  // column can never disagree about what "Closed" looks like.
  const seal = $derived(matterStatusPresentation(matter.status));
  const step = $derived(matterLifecycleStep(matter.status));

  // The lifecycle glyph per step. Closing wears Archive rather than a destructive glyph: the record
  // stays additive after a close, and a bin would say the file was destroyed.
  const STEP_ICON = { open: FolderOpen, close: Archive, reopen: RotateCcw };
  const VERDICT_ICON: Record<MatterCloseVerdict, typeof CircleCheck> = {
    checking: CircleDashed,
    ready: CircleCheck,
    blocked: CircleAlert,
    unknown: CircleDashed,
  };
  const VERDICT_TONE: Record<MatterCloseVerdict, string> = {
    checking: "text-text-subtle",
    ready: "text-status-success-subtle-foreground",
    blocked: "text-status-danger-subtle-foreground",
    unknown: "text-text-subtle",
  };

  let open = $state(false);
  let working = $state(false);
  /** The step that was taken, held so the result reads about it and not about the next one. */
  let taken = $state<MatterLifecycleStep | null>(null);
  let notices = $state<readonly MatterCloseNotice[]>([]);
  let failure = $state<string | null>(null);
  let errorId = $state<string | null>(null);

  /** What the program says about closing. Null until the read comes back. */
  let readiness = $state<MatterCloseReadiness | null>(null);
  let readinessFailed = $state(false);

  /** Null until the session read comes back, either way; `settled` is what tells the two apart. */
  let permissions = $state<readonly string[] | null>(null);
  let sessionSettled = $state(false);

  const identifier = $props.id();
  const blockedDescriptionIdentifier = `${identifier}-blocked`;

  const StepIcon = $derived(STEP_ICON[step.action]);
  const isSample = $derived(matter.source === "sample");
  const standing = $derived(matterCloseStanding(readiness, readinessFailed));
  const VerdictIcon = $derived(VERDICT_ICON[standing.verdict]);
  // The paper file belongs to a matter the firm has taken on. A consultation has not drawn a number
  // and has no place in a file room, so the rows are not drawn rather than drawn empty.
  const hasPhysicalFile = $derived(matter.matterNumber !== null);
  const block = $derived(matterLifecycleBlock({ step, isSample, sessionSettled, permissions }));
  // A control does not offer a press whose refusal is already on the screen. `checking` and
  // `unknown` are NOT refusals and never disable it: nothing has been predicted there, and the
  // close is the authority either way.
  const refused = $derived(step.action === "close" && standing.verdict === "blocked");

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

  // A window opened again starts on the step, not on the last answer it gave.
  $effect(() => {
    if (!open) return;
    taken = null;
    notices = [];
    failure = null;
    errorId = null;
  });

  function report(outcome: Exclude<ApiOutcome<unknown>, { kind: "ok" }>): void {
    if (outcome.kind === "transport") {
      failure = MATTER_LIFECYCLE_TRANSPORT_FAILURE;
      return;
    }
    errorId = outcome.problem.errorId ?? null;
    // A close refused at the last moment is the same answer the verdict already holds, arriving
    // later: it lands there rather than beside it, so the window never shows two accounts of the
    // matter's readiness at once.
    const refused = matterCloseRefusals(outcome.problem);
    if (refused.length > 0) {
      readiness = {
        matterId: matter.id,
        status: matter.status,
        closable: false,
        blockers: [...refused],
      };
      readinessFailed = false;
      return;
    }
    failure = outcome.problem.detail ?? step.failureSentence;
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
    errorId = null;
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

<Dialog.Root bind:open>
  <!-- The seal is a real button around the chip, never a chip pretending to be one: a Badge labels
       and does not act. The affordance rides the hairline the badge recipe already reserves and
       leaves transparent, so it costs no layout: the pill is outlined at rest (a control has to
       read as one before it is hovered, which is what the overflow button beside it had to learn)
       and the edge strengthens under the pointer. It matters most in dark mode, where the neutral
       Closed chip's tint is all but the page's own ground and the word alone would read as text. -->
  <Dialog.Trigger
    class="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    aria-label="Matter status: {seal.label}"
    title={seal.meaning}
  >
    <Badge
      variant={seal.variant}
      class="border-border-default uppercase hover:border-border-strong"
      style="letter-spacing: var(--mc-tracking-caps)"
    >
      {seal.label}
    </Badge>
  </Dialog.Trigger>

  <Dialog.Content showClose={false} class="max-w-lg">
    <Dialog.Title>Matter Status</Dialog.Title>
    <Dialog.Description>
      {matter.matterNumber === null ? "Consultation" : `Matter ${matter.matterNumber}`} ·
      {matter.title}
    </Dialog.Description>

    {#if taken === null}
      <dl class="flex flex-col gap-8 text-sm">
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Standing</dt>
          <dd>
            <Badge
              variant={seal.variant}
              class="uppercase"
              style="letter-spacing: var(--mc-tracking-caps)"
            >
              {seal.label}
            </Badge>
          </dd>
        </div>

        {#if step.action === "close" && !isSample}
          <!-- The program's answer, not a list for the reader to work through. -->
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">Can Close</dt>
            <dd class="flex items-center gap-4 text-right {VERDICT_TONE[standing.verdict]}">
              <VerdictIcon class="size-16 shrink-0" aria-hidden="true" />
              {standing.sentence}
            </dd>
          </div>
        {/if}

        {#if hasPhysicalFile}
          <!-- The firm's own paper file, which is not the custody register: that one holds client
               property left with the firm to guard. Neither row is served yet, so each says what it
               waits on rather than being left off the window that ought to answer it. -->
          {#each MATTER_PHYSICAL_FILE_FACTS as fact (fact.key)}
            <div class="flex items-baseline justify-between gap-16">
              <dt class="text-text-muted">{fact.label}</dt>
              <dd class="flex items-center gap-8 text-right text-text-subtle">
                Not recorded
                <MaturityBadge stage="soon" />
              </dd>
            </div>
            <p class="-mt-4 text-xs text-text-subtle">{fact.waitingOn}</p>
          {/each}
        {/if}
      </dl>

      {#if standing.blockers.length > 0}
        <Alert.Root variant="danger">
          <Alert.Title>What Is In The Way</Alert.Title>
          <Alert.Description>
            <ul class="flex flex-col gap-4">
              {#each standing.blockers as blocker (blocker.message)}
                <li>{blocker.message}</li>
              {/each}
            </ul>
          </Alert.Description>
        </Alert.Root>
      {/if}

      {#if failure !== null}
        <Alert.Root variant="danger">
          <Alert.Title>{step.failureSentence}</Alert.Title>
          <Alert.Description>
            {failure}{errorId === null ? "" : ` Error ID ${errorId}.`}
          </Alert.Description>
        </Alert.Root>
      {/if}
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

    <div class="flex flex-col gap-8">
      {#if taken === null}
        <!-- What is in the way gets its own line: a disabled control can be neither hovered nor
             focused, so the sentence has to be readable on the screen. -->
        {#if block !== null}
          <p id={blockedDescriptionIdentifier} class="text-xs text-text-subtle">{block}</p>
        {/if}
        <div class="flex items-center justify-end gap-8">
          <Button variant="secondary" disabled={working} onclick={() => (open = false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={block !== null || refused || working}
            title={block ?? undefined}
            aria-describedby={block === null ? undefined : blockedDescriptionIdentifier}
            onclick={take}
          >
            <StepIcon class="size-16" aria-hidden="true" />
            {working ? step.busyLabel : step.label}
          </Button>
        </div>
      {:else}
        <div class="flex items-center justify-end gap-8">
          <Button variant="secondary" onclick={() => (open = false)}>Done</Button>
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
