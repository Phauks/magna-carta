<script lang="ts">
  /*
   * Taking back one recorded match.
   *
   * A WITHDRAWAL IS APPENDED, NEVER A DELETION, and the panel says so where the fear is: a member
   * asserted that a bank line and a recorded entry were the same event, and taking that back has to
   * leave the assertion on the record with who took it back and when. What changes is the item,
   * which becomes outstanding again and can be matched to something else.
   *
   * THE IDEMPOTENCY KEY IS MINTED ON THE GESTURE THAT OPENS THE PANEL and reused on every retry of
   * it, so a withdrawal that timed out is retried rather than asserted twice.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { withdrawTrustReconciliationMatch, type TrustReconciliationMatch } from "./trust-api.ts";
  import { bankItemDirectionLabel } from "./reconciliation-model.ts";
  import { statementLineDirectionLabel } from "./reconciliation-columns.ts";

  let {
    open = $bindable(false),
    reconciliationId,
    match,
    money,
    periodText,
    submissionKey,
    onWithdrawn,
  }: {
    open?: boolean;
    reconciliationId: string;
    /** The match being taken back, or null while the panel is closed. */
    match: TrustReconciliationMatch | null;
    /** How an amount reads, from the surface's own money vocabulary. */
    money: (amountMinor: number) => string;
    /** The period this reconciliation is of, as the surface already reads it. */
    periodText: string;
    /** Minted on the gesture that opened this panel, reused on every retry of it. */
    submissionKey: string;
    onWithdrawn: () => void;
  } = $props();

  let failure = $state<StatedFailure | null>(null);

  /** The bank's own line, as a reader reads one: the day, the amount, what the bank called it. */
  const lineText = $derived(
    match === null
      ? null
      : `${formatDate(match.line.postedOn)} · ${money(match.line.amountMinor)} · ${match.line.description}`,
  );

  /*
   * WHICH ASSERTION IS BEING TAKEN BACK, named where the panel names it. A match has no number
   * somebody could read back, so the line it was made about is what identifies it, and the period
   * says which reconciliation it stands on.
   */
  const subtitle = $derived<RecordSubject>({
    facts: [lineText, periodText].filter((fact): fact is string => fact !== null && fact !== ""),
  });

  async function withdraw(): Promise<ActionOutcome> {
    if (match === null) return "refused";
    failure = null;
    const outcome = await withdrawTrustReconciliationMatch(
      fetch,
      reconciliationId,
      match.id,
      submissionKey,
    );
    if (outcome.kind === "ok") {
      onWithdrawn();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The match still stands.",
      "Couldn't connect. The match is unchanged. You can safely try again.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="confirm"
  heading="Withdraw Match"
  {subtitle}
  commitLabel="Withdraw Match"
  commitBusyLabel="Withdrawing"
  commitRefusal={match === null ? "No match is chosen." : undefined}
  onOpen={() => (failure = null)}
  onCommit={withdraw}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Match Still Stands"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields()}
    <DefinitionList.Root>
      <DefinitionList.Row term="Statement Line" empty={match === null}>
        {match === null
          ? ""
          : `${formatDate(match.line.postedOn)} · ${statementLineDirectionLabel(match.line.direction)} · ${money(match.line.amountMinor)} · ${match.line.description}`}
      </DefinitionList.Row>
      <DefinitionList.Row term="Recorded Item" empty={match === null}>
        {match === null
          ? ""
          : `${formatDate(match.item.effectiveDate)} · ${bankItemDirectionLabel(match.item)} · ${money(match.item.bankDeltaMinor)} · ${match.item.description}`}
      </DefinitionList.Row>
      <DefinitionList.Row term="What Changes">
        The item becomes outstanding again and can be matched to another line. The original match stays on record with who withdrew it and when.
      </DefinitionList.Row>
    </DefinitionList.Root>
  {/snippet}
</ActionDialog>
