<script lang="ts">
  /*
   * Opening a reconciliation of one recorded statement.
   *
   * THE ACCOUNT IS THE STATEMENT'S AND IS NEVER CHOSEN HERE. A reconciliation belongs to the period
   * a bank reported, so the panel is handed the statement and asks nothing about which account it
   * sits in. Offering an account picker beside a statement picker would invite somebody to
   * reconcile one account's period against another's books.
   *
   * A CORRECTION IS A NEW RECONCILIATION, NOT AN EDIT. Where the statement has been reconciled
   * before, the panel says which one and offers it as the reconciliation this one supersedes. The
   * old one stays on the record: a firm's attestation about a period is not something the platform
   * lets anybody quietly replace, and the supersession is what makes the correction legible.
   *
   * THE IDEMPOTENCY KEY IS MINTED WHEN THE PANEL OPENS. Two reconciliations of one statement are a
   * real thing a firm can hold, so nothing downstream could tell a retry from a deliberate second
   * one. Minting on the opening gesture is what makes a retry a retry.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatInstant, placeholderOf } from "@magna-carta/design-system/formatters";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { openTrustReconciliation } from "./trust-api.ts";
  import type { TrustBankStatement, TrustReconciliation } from "./trust-api.ts";
  import {
    reconciliationStandingLabel,
    statementPeriodText,
    trustMoneyText,
  } from "./firm-trust-vocabulary.ts";

  let {
    open = $bindable(false),
    statement,
    reconciliations,
    onOpened,
  }: {
    open?: boolean;
    /** The period being reconciled, as the bank reported it. */
    statement: TrustBankStatement;
    /** Every reconciliation the account holds, of any statement. */
    reconciliations: readonly TrustReconciliation[];
    /** The reconciliation was opened. The surface goes to it. */
    onOpened: (reconciliationId: string) => void;
  } = $props();

  const fieldPrefix = $props.id();

  let supersedesReconciliationId = $state("");
  let note = $state("");
  let failure = $state<StatedFailure | null>(null);

  /** The submission this panel is making, reused on every retry of it. */
  let submissionKey = "";

  const money = (amountMinor: number): string => trustMoneyText(amountMinor, statement.currency);

  /*
   * The reconciliations of THIS statement, most recently opened first. A reconciliation of another
   * period is not something this one could supersede, so it is never offered.
   */
  const existing = $derived(
    reconciliations
      .filter((reconciliation) => reconciliation.statementId === statement.id)
      .toSorted((left, right) => right.openedAt.localeCompare(left.openedAt)),
  );

  const supersedeChoices = $derived<readonly ChoiceOption[]>(
    existing.map((reconciliation) => ({
      value: reconciliation.id,
      label: `Opened ${formatInstant(reconciliation.openedAt)}`,
      aside: reconciliationStandingLabel(reconciliation.status),
      meaning:
        reconciliation.status === "closed"
          ? "Closed, with the proof the firm attested to frozen on it. This one would supersede that attestation."
          : "Still open. This one would supersede it.",
    })),
  );

  function reset(): void {
    // The most recent reconciliation of this statement is what a correction almost always replaces,
    // and it is offered rather than imposed: the picker still holds every one of them.
    supersedesReconciliationId = existing[0]?.id ?? "";
    note = "";
    failure = null;
    submissionKey = crypto.randomUUID();
  }

  const started = $derived(note.trim() !== "");

  async function openReconciliation(): Promise<ActionOutcome> {
    failure = null;
    const outcome = await openTrustReconciliation(
      fetch,
      {
        statementId: statement.id,
        supersedesReconciliationId:
          supersedesReconciliationId === "" ? null : supersedesReconciliationId,
        note: note.trim() === "" ? null : note.trim(),
      },
      submissionKey,
    );
    if (outcome.kind === "ok") {
      onOpened(outcome.value.trustReconciliationId);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "No reconciliation was opened.",
      "Nothing answered, so no reconciliation was opened. Retrying sends this same submission rather than opening a second one.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Open Reconciliation"
  subtitle={{ facts: [statementPeriodText(statement)] }}
  commitLabel="Open Reconciliation"
  commitBusyLabel="Opening"
  unsavedChanges={started}
  onOpen={reset}
  onCommit={openReconciliation}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="No Reconciliation Was Opened"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <DefinitionList.Root>
        <DefinitionList.Row term="Period">{statementPeriodText(statement)}</DefinitionList.Row>
        <DefinitionList.Row term="Opening Balance">
          {money(statement.openingBalanceMinor)}
        </DefinitionList.Row>
        <DefinitionList.Row term="Closing Balance">
          {money(statement.closingBalanceMinor)}
        </DefinitionList.Row>
        <DefinitionList.Row term="Reference" empty={statement.statementReference === null}>
          {statement.statementReference ?? ""}
        </DefinitionList.Row>
      </DefinitionList.Root>

      {#if existing.length > 0}
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-supersedes">Supersedes</Label>
          <ChoicePicker
            inputId="{fieldPrefix}-supersedes"
            label="Supersedes"
            options={supersedeChoices}
            value={supersedesReconciliationId}
            disabled={busy}
            onchange={(next) => (supersedesReconciliationId = next)}
          />
          <p class="mc-form-description">
            This period has been reconciled before. A correction is a new reconciliation that
            supersedes the old one, so what the firm attested to then stays on the record.
          </p>
        </div>
      {/if}

      <LabelledField label="Note" hint="Why this reconciliation is being opened, where that is worth recording.">
        {#snippet children({ props })}
          <Textarea
            {...props}
            placeholder={placeholderOf("Note")}
            rows={3}
            disabled={busy}
            bind:value={note}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}
</ActionDialog>
