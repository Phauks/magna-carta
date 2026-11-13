<script lang="ts">
  /*
   * Review: the submitted costs, one at a time.
   *
   * Reviewing a queue is a different act from reading a ledger. The reviewer wants the facts that
   * decide the question — what it was, who was paid, how much, what backs it — and three answers:
   * approve it, send it back with an instruction, or leave it and look at the next.
   * Nothing else belongs in the way.
   *
   * THE QUEUE IS TAKEN ONCE AND WALKED. It is a snapshot of what was submitted when Review opened,
   * so approving one cost cannot reshuffle the reviewer's place in the list underneath them. A cost
   * that has left the submitted state between then and now is skipped rather than shown.
   *
   * IT IS A READING PANEL WHOSE STEPS SIT BESIDE THE FACTS. The bar has nothing to commit: the act
   * is one of three, taken against the cost in view, and the panel goes on to the next rather than
   * closing — so the three sit in the body under the facts they decide, and the bar ends at Close.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import Button from "@magna-carta/design-system/button";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import Reply from "@lucide/svelte/icons/reply";
  import Stamp from "@lucide/svelte/icons/stamp";
  import { expenseCodeText, type ExpenseCodeLabels } from "./cost-columns.ts";
  import { gapCellTitle } from "./cost-gaps.ts";
  import { approveCost, writeKey, type CostLedgerEntry } from "./cost-operations.ts";
  import { billingLabel, payeeText } from "./cost-vocabulary.ts";
import { GONE_RECORDER_NOTE, recorderState, recorderText } from "$lib/records/work-in-progress-record.ts";

  let {
    open = $bindable(false),
    queue,
    currency,
    expenseCodeLabels,
    onApproved,
    onKickBack,
  }: {
    open?: boolean;
    /** The costs waiting for review when the walk started. */
    queue: readonly CostLedgerEntry[];
    currency: string;
    expenseCodeLabels: ExpenseCodeLabels;
    /** One cost was approved. The consumer re-reads the matter's costs. */
    onApproved: () => void;
    /** The reviewer wants this one sent back. The consumer opens the reason dialog. */
    onKickBack: (cost: CostLedgerEntry) => void;
  } = $props();

  let position = $state(0);
  let sending = $state(false);
  let failure = $state<StatedFailure | null>(null);

  // Opening starts the walk at the top. Reopening after a change starts the new queue at the top
  // too, which is the honest answer: the queue is not the same queue.
  function restart(): void {
    position = 0;
    failure = null;
  }

  const current = $derived(queue[position] ?? null);
  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });
  const subtitle = $derived<RecordSubject>(
    current === null ? {} : { facts: [`${position + 1} of ${queue.length} submitted`] },
  );

  function step(): void {
    if (position + 1 >= queue.length) {
      // The walk is over: the panel leaves. A prop changing, not a gesture, so it runs no guard.
      open = false;
      return;
    }
    position += 1;
    failure = null;
  }

  async function approve(): Promise<void> {
    if (current === null || sending) return;
    sending = true;
    failure = null;
    const outcome = await approveCost(fetch, current.id, writeKey());
    sending = false;
    if (outcome.kind !== "ok") {
      failure = stated(
        outcome.failure,
        "The cost was not approved.",
        "The cost was not approved and is unchanged.",
      );
      return;
    }
    onApproved();
    step();
  }
</script>

{#snippet fact(label: string, value: string, title?: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right tabular-nums" {title}>{value}</dd>
  </div>
{/snippet}

<ActionDialog bind:open kind="reading" heading="Review Costs" {subtitle} onOpen={restart}>
  {#snippet fields()}
    {#if current !== null}
      <dl class="flex flex-col gap-4 text-sm">
        {@render fact("Date Incurred", formatDate(current.incurredDate))}
        {@render fact("Payee", payeeText(current))}
        {@render fact("Amount", money(current.amountMinor))}
        {@render fact("Billing", billingLabel(current.billable))}
        {@render fact(
          "Expense Code",
          expenseCodeText(current, expenseCodeLabels) === ""
            ? "—"
            : expenseCodeText(current, expenseCodeLabels),
        )}
        {@render fact("Attachments", "Not served", gapCellTitle("attachments"))}
        {@render fact(
          "Entered By",
          recorderText(current),
          recorderState(current).kind === "gone" ? GONE_RECORDER_NOTE : undefined,
        )}
      </dl>
      <p class="text-sm">{current.description}</p>

      <!-- The three answers, under the facts they decide. Approve is the strong hand; Skip leaves
           the cost as it is and walks on. -->
      <div class="flex flex-wrap items-center justify-end gap-8">
        <Button
          variant="secondary"
          disabled={sending}
          title="Leave this cost submitted and look at the next"
          onclick={step}
        >
          Skip
        </Button>
        <Button
          variant="secondary"
          disabled={sending}
          title="Return this cost to draft with a recorded reason"
          onclick={() => {
            if (current === null) return;
            open = false;
            onKickBack(current);
          }}
        >
          <Reply class="size-16" aria-hidden="true" />
          Kick Back
        </Button>
        <Button
          disabled={sending}
          title="Approve: the cost becomes billable on the next bill"
          onclick={() => void approve()}
        >
          <Stamp class="size-16" aria-hidden="true" />
          {sending ? "Approving" : "Approve"}
        </Button>
      </div>
    {/if}
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Changed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}
</ActionDialog>
