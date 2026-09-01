<script lang="ts">
  /*
   * The status seal, and the window behind it. Changing a matter's status is done HERE, by pressing
   * the standing itself.
   *
   * WHY THE SEAL IS THE CONTROL. The status is the fact the top-left corner of a matter exists to
   * state, and it is the only thing on the masthead a person changes rather than edits. Putting the
   * change behind an overflow menu made the two strangers: you read the standing in one place and
   * changed it in another, three gestures away, with no chance to say what changing it would do.
   * Pressing the standing is the shortest possible path from noticing it to acting on it, and it is
   * where somebody looks anyway.
   *
   * WHAT THE WINDOW IS FOR. It is not a confirmation. A confirmation asks "are you sure" about a
   * step it has already described in three words; this window is where the step gets described at
   * all: what it does to the record, and what the firm's own rules check before it will happen. That
   * is why closing gets the room it does. Closing is the step somebody takes once, on somebody
   * else's file, and both things people assume about it are wrong: it does not seal the matter, and
   * it will not quietly go through with money still in the client's trust ledger.
   *
   * THE STEP IS NEVER A CHOICE. One step per standing, because that is the shape of the lifecycle
   * and of the contract under it. The words all live in matter-lifecycle.ts, where they can be
   * tested; this file renders them and runs the call.
   *
   * A REFUSED CLOSE IS THE INTERESTING ANSWER, NOT AN ERROR. The trust and client-credit rules
   * answer with the amount, where it sits, and the movements that clear it. Those sentences are
   * rendered as they were written, one row each; collapsing them into "the matter could not be
   * closed" would throw away the only part a person can act on.
   */
  import { invalidateAll } from "$app/navigation";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Archive from "@lucide/svelte/icons/archive";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import type { MatterRecord } from "./matter-record.ts";
  import { matterStatusPresentation } from "./matter-status.ts";
  import {
    matterCloseRefusals,
    matterLifecycleBlock,
    matterLifecycleStep,
    MATTER_LIFECYCLE_TRANSPORT_FAILURE,
    type MatterCloseRefusal,
    type MatterLifecycleAction,
    type MatterLifecycleStep,
  } from "./matter-lifecycle.ts";
  import {
    closeMatter,
    openMatter,
    readSession,
    reopenMatter,
    type MatterCloseNotice,
  } from "./matters-api.ts";
  import type { ApiOutcome } from "$lib/api/request.ts";

  let { matter }: { matter: MatterRecord } = $props();

  // The seal comes from the one matter-status register, so this control and the docket's status
  // column can never disagree about what "Closed" looks like.
  const seal = $derived(matterStatusPresentation(matter.status));
  const step = $derived(matterLifecycleStep(matter.status));

  // The lifecycle glyph per step. Closing wears Archive rather than a destructive glyph: the record
  // stays additive after a close, and a bin would say the file was destroyed.
  const STEP_ICON: Record<MatterLifecycleAction, typeof Archive> = {
    open: FolderOpen,
    close: Archive,
    reopen: RotateCcw,
  };

  let open = $state(false);
  let working = $state(false);
  /** The step that was taken, held so the result reads about it and not about the next one. */
  let taken = $state<MatterLifecycleStep | null>(null);
  let notices = $state<readonly MatterCloseNotice[]>([]);
  let refusals = $state<readonly MatterCloseRefusal[]>([]);
  let failure = $state<string | null>(null);
  let errorId = $state<string | null>(null);

  /** Null until the session read comes back, either way; `settled` is what tells the two apart. */
  let permissions = $state<readonly string[] | null>(null);
  let sessionSettled = $state(false);

  const identifier = $props.id();
  const blockedDescriptionIdentifier = `${identifier}-blocked`;

  const StepIcon = $derived(STEP_ICON[step.action]);
  const isSample = $derived(matter.source === "sample");
  const block = $derived(
    matterLifecycleBlock({ step, isSample, sessionSettled, permissions }),
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

  // A window opened again starts on the step, not on the last answer it gave.
  $effect(() => {
    if (!open) return;
    taken = null;
    notices = [];
    refusals = [];
    failure = null;
    errorId = null;
  });

  function report(outcome: Exclude<ApiOutcome<unknown>, { kind: "ok" }>): void {
    if (outcome.kind === "transport") {
      failure = MATTER_LIFECYCLE_TRANSPORT_FAILURE;
      return;
    }
    errorId = outcome.problem.errorId ?? null;
    // A refused close carries its reasons; anything else has at most the server's own sentence.
    refusals = matterCloseRefusals(outcome.problem);
    failure = refusals.length > 0 ? null : (outcome.problem.detail ?? step.failureSentence);
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
    if (working || block !== null) return;
    const completed = step;
    working = true;
    refusals = [];
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

  <Dialog.Content showClose={false} class="max-w-xl">
    <Dialog.Title>Matter Status</Dialog.Title>
    <Dialog.Description>
      {matter.matterNumber === null ? "Consultation" : `Matter ${matter.matterNumber}`} ·
      {matter.title}
    </Dialog.Description>

    <div class="flex items-center gap-8 text-sm">
      <span class="text-text-muted">Standing Now</span>
      <Badge variant={seal.variant} class="uppercase" style="letter-spacing: var(--mc-tracking-caps)"
        >{seal.label}</Badge
      >
    </div>

    {#if taken === null}
      <div class="flex flex-col gap-8">
        <h3 class="text-xs text-text-subtle uppercase">{step.consequencesHeading}</h3>
        <ul class="flex list-disc flex-col gap-4 ps-16 text-sm">
          {#each step.consequences as consequence (consequence)}
            <li>{consequence}</li>
          {/each}
        </ul>
      </div>

      {#if step.requirements.length > 0}
        <div class="flex flex-col gap-8">
          <h3 class="text-xs text-text-subtle uppercase">What It Requires</h3>
          <ul class="flex list-disc flex-col gap-4 ps-16 text-sm text-text-muted">
            {#each step.requirements as requirement (requirement)}
              <li>{requirement}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if refusals.length > 0}
        <Alert.Root variant="danger">
          <Alert.Title>{step.failureSentence}</Alert.Title>
          <Alert.Description>
            <ul class="flex flex-col gap-4">
              {#each refusals as refusal (refusal.reason)}
                <li>{refusal.reason}</li>
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
        <!-- What is in the way gets its own line rather than a seat beside the buttons: a disabled
             control can be neither hovered nor focused, so the sentence has to be readable on the
             screen, and a sentence sharing the row pushed the actions onto a second line. -->
        {#if block !== null}
          <p id={blockedDescriptionIdentifier} class="text-xs text-text-subtle">{block}</p>
        {/if}
        <div class="flex items-center justify-end gap-8">
          <Button variant="secondary" disabled={working} onclick={() => (open = false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={block !== null || working}
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
