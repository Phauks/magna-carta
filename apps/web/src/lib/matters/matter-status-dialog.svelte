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
  import { formatMoney } from "@magna-carta/design-system/data-table";
  import Archive from "@lucide/svelte/icons/archive";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Square from "@lucide/svelte/icons/square";
  import SquareCheck from "@lucide/svelte/icons/square-check";
  import SquareX from "@lucide/svelte/icons/square-x";
  import type { MatterRecord } from "./matter-record.ts";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import type { MaturityStage } from "$lib/maturity/maturity.ts";
  import { matterSections } from "./sections.ts";
  import { matterStatusPresentation } from "./matter-status.ts";
  import {
    matterCloseChecklist,
    matterCloseConsiderations,
    matterCloseRefusals,
    matterLifecycleBlock,
    matterLifecycleStep,
    MATTER_LIFECYCLE_TRANSPORT_FAILURE,
    type MatterCloseCheck,
    type MatterCloseCheckState,
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
  import { readMatterUnbilled, type MatterUnbilled } from "$lib/billing/billing-api.ts";
  import { listCustodyPackets } from "$lib/custodian/custody-api.ts";
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
  /** Null until a close has been attempted: nothing has asked the rules, so nothing is known. */
  let refusals = $state<readonly MatterCloseRefusal[] | null>(null);
  let failure = $state<string | null>(null);
  let errorId = $state<string | null>(null);

  /** What the firm still holds against the matter. Null while unread, and after a read that failed. */
  let unbilled = $state<MatterUnbilled | null>(null);
  let custodyPacketCount = $state<number | null>(null);

  /** Null until the session read comes back, either way; `settled` is what tells the two apart. */
  let permissions = $state<readonly string[] | null>(null);
  let sessionSettled = $state(false);

  const identifier = $props.id();
  const blockedDescriptionIdentifier = `${identifier}-blocked`;

  const StepIcon = $derived(STEP_ICON[step.action]);
  const isSample = $derived(matter.source === "sample");
  const checklist = $derived(matterCloseChecklist(refusals));
  // The firm's own currency is not read anywhere yet, and neither is a per-matter one. The billing
  // surfaces default the same way and for the same reason, so this reads as they do rather than
  // inventing a second answer.
  const considerations = $derived(
    matterCloseConsiderations({
      unbilled,
      custodyPacketCount,
      money: (amountMinor) => formatMoney(amountMinor / 100, { currency: "USD" }),
    }),
  );

  const CHECK_ICON: Record<MatterCloseCheckState, typeof Square> = {
    unknown: Square,
    met: SquareCheck,
    blocked: SquareX,
  };
  const CHECK_TONE: Record<MatterCloseCheckState, string> = {
    unknown: "text-text-subtle",
    met: "text-status-success-subtle-foreground",
    blocked: "text-status-danger-subtle-foreground",
  };

  /**
   * Where a requirement or a consideration is settled, read from the section registry so this
   * window cannot name a section that does not exist or label one differently from the nav.
   *
   * The stage comes with it because a section that is not built yet must not be dressed as a live
   * link: Trust is where a client ledger is cleared and it is still a stub, so it is named with the
   * Soon mark rather than offered as somewhere to go. That is the same rule a Soon control follows,
   * applied to a destination.
   */
  function sectionLink(
    slug: string,
  ): { href: string; label: string; stage: MaturityStage } | null {
    const section = matterSections.find((candidate) => candidate.slug === slug);
    if (section === undefined) return null;
    return {
      href: `/matters/${matter.id}/${section.slug}`,
      label: section.label,
      stage: section.stage,
    };
  }
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

  // What the firm still holds against the matter, read only where it bears on the step in front of
  // the reader: a close. Neither read gates anything, so a failure leaves its row unwritten rather
  // than the window unusable — a consideration nobody could read is not a reason to refuse a close.
  let holdingsRead = false;
  $effect(() => {
    if (!open || holdingsRead || isSample || step.action !== "close") return;
    holdingsRead = true;
    const matterId = matter.id;
    void (async () => {
      const [work, packets] = await Promise.all([
        readMatterUnbilled(fetch, matterId),
        listCustodyPackets(fetch, { matterId }),
      ]);
      if (work.kind === "ok") unbilled = work.value;
      // The count is what this window shows; the register itself is one link away, which is where
      // a person reads which packets they are and where each one sits.
      if (packets.kind === "ok") custodyPacketCount = packets.value.data.length;
    })();
  });

  // A window opened again starts on the step, not on the last answer it gave.
  $effect(() => {
    if (!open) return;
    taken = null;
    notices = [];
    refusals = null;
    failure = null;
    errorId = null;
  });

  function report(outcome: Exclude<ApiOutcome<unknown>, { kind: "ok" }>): void {
    if (outcome.kind === "transport") {
      failure = MATTER_LIFECYCLE_TRANSPORT_FAILURE;
      return;
    }
    errorId = outcome.problem.errorId ?? null;
    // A refused close carries its reasons, and those resolve the checklist; anything else has at
    // most the server's own sentence, and leaves the checklist unasked rather than answered.
    const refused = matterCloseRefusals(outcome.problem);
    refusals = refused.length > 0 ? refused : null;
    failure = refused.length > 0 ? null : (outcome.problem.detail ?? step.failureSentence);
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
    refusals = null;
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

<!-- One destination, rendered two ways for one reason: a section that is built is somewhere to
     go, and a section that is not is somewhere to be told about. Never a link that lands on a
     stub and leaves a person no better off than before they followed it. -->
{#snippet destination(link: { href: string; label: string; stage: MaturityStage })}
  {#if link.stage === "soon"}
    <span class="inline-flex items-center gap-4 text-xs text-text-subtle">
      {link.label}
      <MaturityBadge stage={link.stage} />
    </span>
  {:else}
    <a
      href={link.href}
      class="text-text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      onclick={() => (open = false)}
    >
      {link.label}
    </a>
  {/if}
{/snippet}

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

      {#if step.action === "close"}
        {#if refusals !== null}
          <!-- The outcome is announced once, here; the checklist below carries which rule refused
               and in whose words, so the two are never two copies of the same sentence. -->
          <Alert.Root variant="danger">
            <Alert.Title>{step.failureSentence}</Alert.Title>
          </Alert.Root>
        {/if}

        <!-- The gate, as a checklist. Every row rests unticked and says so: neither rule can be
             read from here yet, and a tick nobody verified is the one state a checklist must not
             invent. One press resolves the whole list, because a refused close reports every rule
             that refused and silence about a rule is that rule passing. -->
        <div class="flex flex-col gap-8">
          <h3 class="text-xs text-text-subtle uppercase">Before It Can Close</h3>
          <ul class="flex flex-col gap-8 text-sm">
            {#each checklist as check (check.key)}
              {@const CheckIcon = CHECK_ICON[check.state]}
              {@const link = check.section === null ? null : sectionLink(check.section)}
              <li class="flex items-start gap-8">
                <CheckIcon
                  class="mt-2 size-16 shrink-0 {CHECK_TONE[check.state]}"
                  aria-hidden="true"
                />
                <span class="flex flex-col gap-4">
                  <span class={check.state === "blocked" ? "text-text-default" : "text-text-muted"}>
                    {check.label}
                  </span>
                  {#each check.reasons as reason (reason)}
                    <span class="text-status-danger-subtle-foreground">{reason}</span>
                  {/each}
                  <!-- The way to settle a requirement exists while it is in play and not after: a
                       row the close has already ticked has nothing to go and do. -->
                  {#if link !== null && check.state !== "met"}
                    <span class="self-start">{@render destination(link)}</span>
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
          <!-- The line stays in place and changes its words, never appearing and disappearing
               between states: an unticked box with nothing said about it reads as a failed check,
               which is the opposite of what it means here. -->
          <p class="text-xs text-text-subtle">
            {refusals === null
              ? "Both are checked when you close; neither can be read from this window yet."
              : "Answered by the close that was refused."}
          </p>
        </div>

        <!-- Not requirements, and never becoming them: an unpaid bill's lawful exit is a write-off,
             and a firm holds a client's original for decades after their last matter closed. A
             block with nothing in it is not drawn. -->
        {#if considerations.length > 0}
          <div class="flex flex-col gap-8">
            <h3 class="text-xs text-text-subtle uppercase">Worth Settling First</h3>
            <ul class="flex flex-col gap-8 text-sm leading-normal">
              {#each considerations as consideration (consideration.key)}
                {@const link = sectionLink(consideration.section)}
                <!-- The destination rides the end of the finding rather than sitting on a line of
                     its own: two considerations settled in the same section stacked two identical
                     link lines under each other, which read as one control repeated. -->
                <li class="text-text-muted">
                  {consideration.line}
                  {#if link !== null}
                    {@render destination(link)}
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
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
