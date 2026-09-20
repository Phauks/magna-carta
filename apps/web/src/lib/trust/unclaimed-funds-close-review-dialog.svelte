<script lang="ts">
  /*
   * Ending one round of diligence over a client's trust ledger.
   *
   * CLOSING MOVES NO MONEY, INCLUDING WHEN IT CLOSES AS A DISTRIBUTION. Paying the owner is an
   * ordinary payment out, proposed and authorized on the ordinary path; what this panel does is
   * ATTACH that movement to the file, which is why it takes an identifier and not an amount, a
   * payee, a day or a method. The field's own line says so, beside the field, because that is the
   * one thing a reader could otherwise believe this panel is doing.
   *
   * THE MOVEMENT FIELD STANDS REFUSED ON THE OTHER THREE OUTCOMES rather than disappearing: a
   * control that vanishes reflows the panel under the hand of the person filling it in, and the
   * hover says the fact itself, that only a distribution attaches a payment.
   *
   * A ROUND ENDING IS NOT A SEARCH ENDING. "The search continues" is one of the four outcomes, and
   * it closes this file so a later round opens its own: the record of what was done in each round
   * stays whole rather than being amended into one growing file.
   *
   * ONE KEY PER OPENING, REUSED ON EVERY RETRY.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { closeTrustUnclaimedFundsReview, type TrustReviewOutcome } from "./trust-api.ts";
  import { fieldRefusal } from "./trust-write-requests.ts";
  import {
    readTrustUnclaimedFundsClosure,
    trustMovementIsRequired,
  } from "./unclaimed-funds-requests.ts";
  import {
    TRUST_MOVEMENT_HINT,
    TRUST_MOVEMENT_LABEL,
    TRUST_MOVEMENT_NOT_ASKED,
    reviewOutcomeChoices,
    reviewOutcomeMeaning,
  } from "./unclaimed-funds-vocabulary.ts";

  let {
    open = $bindable(false),
    reviewId,
    matterNumber,
    matterTitle,
    onClosed,
  }: {
    open?: boolean;
    /** The file being closed, or null while none is open in the window. */
    reviewId: string | null;
    matterNumber: string | null;
    matterTitle: string | null;
    /** The round closed: the window re-reads the file and the section re-reads the ledgers. */
    onClosed: () => void;
  } = $props();

  let outcome = $state<TrustReviewOutcome>("search_continues");
  let trustMovementId = $state("");
  let note = $state("");
  let failure = $state<StatedFailure | null>(null);
  /** Minted on the gesture that opens the panel, reused on every retry of this one submission. */
  let submissionKey = $state("");

  const outcomeChoices = reviewOutcomeChoices();

  function reset(): void {
    outcome = "search_continues";
    trustMovementId = "";
    note = "";
    failure = null;
    submissionKey = crypto.randomUUID();
  }

  const movementWanted = $derived(trustMovementIsRequired(outcome));

  const reading = $derived(readTrustUnclaimedFundsClosure({ outcome, trustMovementId, note }));

  const refusal = $derived.by((): string | undefined => {
    if (reviewId === null) return "No file is open to close.";
    return reading.kind === "refused" ? reading.reason : undefined;
  });

  /* The matter whose money this round was about, by the number somebody reads back out loud. */
  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Matter", number: matterNumber },
    facts: matterTitle === null ? [] : [matterTitle],
  });

  const serverProblem = $derived(failure?.failure.problem ?? null);

  const started = $derived(
    outcome !== "search_continues" || trustMovementId.trim() !== "" || note.trim() !== "",
  );

  async function closeReview(): Promise<ActionOutcome> {
    if (reviewId === null || reading.kind !== "request") return "refused";
    failure = null;
    const result = await closeTrustUnclaimedFundsReview(
      fetch,
      reviewId,
      reading.request,
      submissionKey,
    );
    if (result.kind === "ok") {
      onClosed();
      return "committed";
    }
    failure = stated(
      result.failure,
      "The round was not closed, so the file is still open. No money moved either way.",
      "Nothing answered, so the round was not closed. The file is still open and no money moved.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Close Review"
  {subtitle}
  commitLabel="Close Review"
  commitBusyLabel="Closing"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={closeReview}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Round Was Not Closed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <LabelledField
        label="Outcome"
        hint={reviewOutcomeMeaning(outcome)}
        error={fieldRefusal(serverProblem, "outcome")}
      >
        {#snippet children({ props })}
          <ChoicePicker
            inputId={props.id}
            label="Outcome"
            options={outcomeChoices}
            disabled={busy}
            bind:value={
              () => outcome, (chosen) => (outcome = chosen as TrustReviewOutcome)
            }
          />
        {/snippet}
      </LabelledField>

      <LabelledField
        label={TRUST_MOVEMENT_LABEL}
        hint={movementWanted ? TRUST_MOVEMENT_HINT : TRUST_MOVEMENT_NOT_ASKED}
        error={fieldRefusal(serverProblem, "trustMovementId")}
      >
        {#snippet children({ props })}
          <Input
            {...props}
            placeholder={placeholderOf(TRUST_MOVEMENT_LABEL)}
            disabled={busy || !movementWanted}
            title={movementWanted ? undefined : TRUST_MOVEMENT_NOT_ASKED}
            bind:value={trustMovementId}
          />
        {/snippet}
      </LabelledField>

      <LabelledField
        label="Note"
        hint="What the round came to, where that is worth recording."
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
    </div>
  {/snippet}
</ActionDialog>
