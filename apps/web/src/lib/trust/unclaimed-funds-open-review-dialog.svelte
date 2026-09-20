<script lang="ts">
  /*
   * Opening a diligence file over one client's trust ledger.
   *
   * THE OBSERVATION IS STATED, NEVER ASKED FOR. The balance, the earliest receipt and the last
   * activity are what the dormant-balances read just served, and they are what the server stores
   * with the file as the thing the reviewer acted on. Offering them as fields would let somebody
   * open a file over figures the ledger never held; showing them as values is the panel saying, in
   * the reader's own words, exactly what is about to be written down.
   *
   * NOTHING HERE MOVES MONEY, and the panel says so where it can be read before the commit rather
   * than leaving somebody to infer it from a control called Open Review sitting under a client's
   * balance.
   *
   * ONE KEY PER OPENING, REUSED ON EVERY RETRY. Minted when the panel opens rather than when the
   * commit is pressed: a ledger carries one open review, so a second submission would be refused
   * rather than duplicated, and a reader answering a refusal and pressing through again must be
   * making the same submission.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { openTrustUnclaimedFundsReview, type TrustDormantBalance } from "./trust-api.ts";
  import { dayText } from "./firm-trust-vocabulary.ts";
  import { fieldRefusal } from "./trust-write-requests.ts";
  import { readTrustUnclaimedFundsReviewOpening } from "./unclaimed-funds-requests.ts";
  import {
    OBSERVATION_MEANING,
    OPENING_MOVES_NO_MONEY,
  } from "./unclaimed-funds-vocabulary.ts";

  let {
    open = $bindable(false),
    trustAccountId,
    balance,
    matterNumber,
    matterTitle,
    money,
    onOpened,
  }: {
    open?: boolean;
    trustAccountId: string;
    /** The quiet ledger the file is opened over, as the read served it. */
    balance: TrustDormantBalance | null;
    matterNumber: string | null;
    matterTitle: string | null;
    money: (amountMinor: number) => string;
    /** The file was opened: the section re-reads the quiet ledgers, which now name it. */
    onOpened: (trustUnclaimedFundsReviewId: string) => void;
  } = $props();

  let note = $state("");
  let failure = $state<StatedFailure | null>(null);
  /** Minted on the gesture that opens the panel, reused on every retry of this one submission. */
  let submissionKey = $state("");

  function reset(): void {
    note = "";
    failure = null;
    submissionKey = crypto.randomUUID();
  }

  const reading = $derived(
    readTrustUnclaimedFundsReviewOpening({
      trustAccountId,
      matterId: balance?.matterId ?? "",
      observedBalanceMinor: balance?.balanceMinor ?? 0,
      observedEarliestReceiptDate: balance?.earliestReceiptDate ?? null,
      observedLastActivityDate: balance?.lastActivityDate ?? null,
      note,
    }),
  );

  const refusal = $derived(reading.kind === "refused" ? reading.reason : undefined);

  /*
   * The matter whose money this is, by the number somebody reads back down a telephone. The number
   * is the reference and the title stands beside it; the balance is the other fact worth having on
   * the line, because it is the figure the file is being opened over.
   */
  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Matter", number: matterNumber },
    facts: [
      matterTitle,
      balance === null ? null : money(balance.balanceMinor),
    ].filter((fact): fact is string => fact !== null),
  });

  const serverProblem = $derived(failure?.failure.problem ?? null);

  async function openReview(): Promise<ActionOutcome> {
    if (reading.kind !== "request") return "refused";
    failure = null;
    const outcome = await openTrustUnclaimedFundsReview(fetch, reading.request, submissionKey);
    if (outcome.kind === "ok") {
      onOpened(outcome.value.trustUnclaimedFundsReviewId);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "No file was opened. This ledger is unchanged, and no money moved.",
      "Nothing answered, so no file was opened. This ledger is unchanged, and no money moved.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Open Review"
  {subtitle}
  commitLabel="Open Review"
  commitBusyLabel="Opening"
  commitRefusal={refusal}
  unsavedChanges={note.trim() !== ""}
  onOpen={reset}
  onCommit={openReview}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="No File Was Opened"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <!-- The observation, exactly as the read served it: these are the figures the file stores as
           what the reviewer acted on, so they are shown rather than asked for. -->
      <DefinitionList.Root>
        <DefinitionList.Row term="Balance" title={OBSERVATION_MEANING} empty={balance === null}>
          <span class="tabular-nums">{balance === null ? "" : money(balance.balanceMinor)}</span>
        </DefinitionList.Row>
        <DefinitionList.Row
          term="Earliest Receipt"
          empty={balance === null || balance.earliestReceiptDate === null}
        >
          {balance === null || balance.earliestReceiptDate === null
            ? ""
            : dayText(balance.earliestReceiptDate)}
        </DefinitionList.Row>
        <DefinitionList.Row
          term="Last Activity"
          empty={balance === null || balance.lastActivityDate === null}
        >
          {balance === null || balance.lastActivityDate === null
            ? ""
            : dayText(balance.lastActivityDate)}
        </DefinitionList.Row>
        {#if balance === null}
          <DefinitionList.Empty>
            No quiet ledger is chosen, so there is nothing to open a file over.
          </DefinitionList.Empty>
        {/if}
      </DefinitionList.Root>

      <LabelledField
        label="Note"
        hint="Why this ledger is being looked at, where that is worth recording."
        error={fieldRefusal(serverProblem, "note")}
      >
        {#snippet children({ props })}
          <Textarea
            {...props}
            rows={3}
            resizable={false}
            placeholder={placeholderOf("Note")}
            disabled={busy}
            bind:value={note}
          />
        {/snippet}
      </LabelledField>

      <p class="mc-form-description">{OPENING_MOVES_NO_MONEY}</p>
    </div>
  {/snippet}
</ActionDialog>
