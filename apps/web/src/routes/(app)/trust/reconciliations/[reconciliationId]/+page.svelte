<script lang="ts">
  /*
   * ONE RECONCILIATION — the working surface for proving a period of a trust bank account.
   *
   * THE PROOF COMES FIRST, AND ITS STRUCTURE STANDS BEFORE THE READ LANDS. The six figures and the
   * verdict are why anybody opens this screen; the two sides beneath them are the work that moves
   * those figures. So the proof's terms render empty and fill, rather than the screen being blank
   * and then arriving as a block of furniture the reader has to take in at once.
   *
   * A CLOSED RECONCILIATION HAS TWO PROOFS AND THEY ARE NOT THE SAME FACT. What the firm attested
   * to is frozen at the moment of closing; the same period recomputed today may differ, because an
   * entry can be recorded against a past day afterwards. Both are shown, each under its own name,
   * and the recomputed one is never presented as the attestation.
   *
   * TWO SIDES, AND A PERSON BETWEEN THEM. The bank's unaccounted lines on the left, the firm's
   * unaccounted entries on the right, and one act between them. Nothing is matched automatically —
   * a wrong automatic match is a wrong assertion about a client's money that nobody would ever have
   * read — so the suggestions mark the candidates for the chosen line and say in words why, and the
   * Match control states, as its own refusal, that a member records every one.
   *
   * EVERY READ FAILS ON ITS OWN. The reconciliation and its proof are the screen; the two sides,
   * the matches and the statement's own words each answer a different question, and a period whose
   * matches cannot be read still has a proof somebody came here to read.
   *
   * A CORRECTION IS A NEW RECONCILIATION. Closing freezes the proof as it stands and writes nothing
   * else; a period that did not balance closes exactly as readily as one that did, recording that
   * it did not tie out.
   */
  import * as Card from "@magna-carta/design-system/card";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import {
    TRUST_PERMISSIONS,
    recordTrustReconciliationMatch,
    type TrustBankItem,
    type TrustBankStatementLine,
    type TrustReconciliationMatch,
  } from "$lib/trust/trust-api.ts";
  import { memberDisplay } from "$lib/trust/trust-member-names.ts";
  import {
    FROZEN_PROOF_MEANING,
    reconciliationStandingLabel,
    statementPeriodText,
    trustMoneyText,
  } from "$lib/trust/firm-trust-vocabulary.ts";
  import { ReconciliationWorkbench } from "$lib/trust/reconciliation-workbench.svelte.ts";
  import {
    BANK_ITEM_COLUMN_IDENTIFIERS,
    BANK_ITEM_INITIAL_SORT,
    MATCH_COLUMN_IDENTIFIERS,
    MATCH_INITIAL_SORT,
    STATEMENT_LINE_INITIAL_SORT,
    bankItemColumns,
    matchColumns,
    statementLineColumns,
  } from "$lib/trust/reconciliation-columns.ts";
  import {
    candidatesForLine,
    closeReading,
    disagreementRows,
    matchRefusal,
    matchStandingLabel,
    matchStandingMeaning,
    proofFigures,
    verdictLabel,
    verdictMeaning,
  } from "$lib/trust/reconciliation-model.ts";
  import ReconciliationCloseDialog from "$lib/trust/reconciliation-close-dialog.svelte";
  import ReconciliationWithdrawMatchDialog from "$lib/trust/reconciliation-withdraw-match-dialog.svelte";

  let { data }: { data: { reconciliationId: string } } = $props();

  const workbench = new ReconciliationWorkbench();

  // ---- who is asking ------------------------------------------------------------------------------

  let permissions = $state<readonly string[] | null>(null);
  let bootstrapped = false;

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") permissions = outcome.value.permissions;
    })();
    // The roster turns the member identifiers on the matches into names. It is not the screen's
    // subject, so the proof never waits on it and an identifier stands where a name has not arrived.
    void firmRoster.load(fetch);
    workbench.load(fetch, data.reconciliationId);
  });

  const managementRefusal = $derived.by((): string | undefined => {
    if (permissions === null) return "Reading your session.";
    if (!permissions.includes(TRUST_PERMISSIONS.manage)) {
      return permissionRefusal("Working a trust reconciliation", TRUST_PERMISSIONS.manage);
    }
    return undefined;
  });

  // ---- what the screen is about --------------------------------------------------------------------

  const reconciliation = $derived(workbench.reconciliation);
  const proof = $derived(workbench.proof);
  const statement = $derived(workbench.statement);

  /*
   * The currency the period is written in, read off the records rather than assumed. The proof
   * states it; the statement states it; both are the account's, and reading it is what keeps the
   * figures right when a firm holds an account in something other than dollars.
   */
  const currency = $derived(proof?.currency ?? statement?.currency ?? "USD");
  const money = (amountMinor: number): string => trustMoneyText(amountMinor, currency);

  const periodText = $derived(
    statement === null ? (proof?.asOfDate ?? "") : statementPeriodText(statement),
  );

  const asMember = (identifier: string): string =>
    memberDisplay(identifier, firmRoster.members).text;

  // ---- the two sides -------------------------------------------------------------------------------

  let selectedLineId = $state<string | null>(null);
  let selectedItemId = $state<string | null>(null);

  const unmatchedLines = $derived(workbench.suggestions?.unmatchedLines ?? []);
  const outstandingItems = $derived(workbench.suggestions?.outstandingItems ?? []);
  const candidates = $derived(
    candidatesForLine(workbench.suggestions?.suggestions ?? [], selectedLineId),
  );

  const lineGrid = DataTable.createDataTableGrid<TrustBankStatementLine>({
    columns: () => statementLineColumns({ money }),
    rows: () => unmatchedLines,
    rowKey: (line) => line.id,
    initialSort: STATEMENT_LINE_INITIAL_SORT,
    itemNoun: { singular: "line", plural: "lines" },
    onSelectionChange: (_keys, selected) => {
      // A different line is a different submission, so whatever was minted for the last one goes.
      selectedLineId = selected.length === 1 ? (selected[0]?.id ?? null) : null;
      matchSubmissionKey = "";
      matchFailure = null;
    },
  });

  const itemGrid = DataTable.createDataTableGrid<TrustBankItem>({
    columns: () =>
      bankItemColumns({
        money,
        candidateText: (ledgerEntryId) => candidates.get(ledgerEntryId)?.text ?? null,
      }),
    rows: () => outstandingItems,
    rowKey: (item) => item.ledgerEntryId,
    initialSort: BANK_ITEM_INITIAL_SORT,
    itemNoun: { singular: "item", plural: "items" },
    onSelectionChange: (_keys, selected) => {
      selectedItemId = selected.length === 1 ? (selected[0]?.ledgerEntryId ?? null) : null;
      matchSubmissionKey = "";
      matchFailure = null;
    },
  });

  // ---- recording a match ----------------------------------------------------------------------------

  /*
   * The assertion this reader is making, minted on the gesture and reused on every retry of it. A
   * fresh key per press would let a retried match record the same assertion twice, which is two
   * rows on the firm's account of one event.
   */
  let matchSubmissionKey = $state("");
  let matching = $state(false);
  let matchFailure = $state<StatedFailure | null>(null);

  const matchRefusalText = $derived(
    matchRefusal({
      permissionRefusal: managementRefusal,
      selectedStatementLineId: selectedLineId,
      selectedLedgerEntryId: selectedItemId,
    }),
  );

  async function recordMatch(): Promise<void> {
    if (selectedLineId === null || selectedItemId === null) return;
    if (matchSubmissionKey === "") matchSubmissionKey = crypto.randomUUID();
    matching = true;
    matchFailure = null;
    const outcome = await recordTrustReconciliationMatch(
      fetch,
      data.reconciliationId,
      { statementLineId: selectedLineId, ledgerEntryId: selectedItemId },
      matchSubmissionKey,
    );
    matching = false;
    if (outcome.kind === "ok") {
      matchSubmissionKey = "";
      selectedLineId = null;
      selectedItemId = null;
      lineGrid.selection = { keys: [], anchor: null, focus: null };
      itemGrid.selection = { keys: [], anchor: null, focus: null };
      workbench.reread(fetch, data.reconciliationId);
      return;
    }
    matchFailure = stated(
      outcome.failure,
      "No match was recorded, and both sides still stand unaccounted for.",
      "Nothing answered, so no match was recorded. Retrying sends this same assertion rather than recording it twice.",
    );
  }

  // ---- the matches --------------------------------------------------------------------------------

  const matches = $derived(workbench.matches ?? []);

  const matchGrid = DataTable.createDataTableGrid<TrustReconciliationMatch>({
    columns: () => matchColumns({ money, memberName: asMember }),
    rows: () => matches,
    rowKey: (match) => match.id,
    initialSort: MATCH_INITIAL_SORT,
    itemNoun: { singular: "match", plural: "matches" },
  });

  let withdrawingMatch = $state<TrustReconciliationMatch | null>(null);
  let withdrawOpen = $state(false);
  let withdrawSubmissionKey = $state("");

  function startWithdraw(match: TrustReconciliationMatch): void {
    withdrawingMatch = match;
    withdrawSubmissionKey = crypto.randomUUID();
    withdrawOpen = true;
  }

  // ---- closing ------------------------------------------------------------------------------------

  const close = $derived(
    closeReading(reconciliation, proof, unmatchedLines.length, outstandingItems.length),
  );
  const closeRefusal = $derived(managementRefusal ?? close.refusal);

  let closeOpen = $state(false);
  let closeSubmissionKey = $state("");

  function startClose(): void {
    closeSubmissionKey = crypto.randomUUID();
    closeOpen = true;
  }

  function recordedSomething(): void {
    workbench.reread(fetch, data.reconciliationId);
  }
</script>

<svelte:head><title>Reconciliation · Trust · Magna Carta</title></svelte:head>

{#snippet itemCell({ row, column, text }: DataTable.GridCellContext<TrustBankItem>)}
  {#if column.id === BANK_ITEM_COLUMN_IDENTIFIERS.suggested}
    {@const mark = candidates.get(row.ledgerEntryId)}
    {#if mark === undefined}
      {text}
    {:else}
      <Badge
        variant="accent"
        title={`Why this is a candidate for the chosen line. The bank posted it ${String(mark.dayGap)} day(s) from the day it was recorded.`}
      >
        {mark.text}
      </Badge>
    {/if}
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet matchCell({ row, column, text }: DataTable.GridCellContext<TrustReconciliationMatch>)}
  {#if column.id === MATCH_COLUMN_IDENTIFIERS.standing}
    <Badge
      variant={row.withdrawnAt === null ? "success" : "neutral"}
      title={matchStandingMeaning(row)}
    >
      {matchStandingLabel(row)}
    </Badge>
  {:else if column.id === MATCH_COLUMN_IDENTIFIERS.recordedBy}
    <span title={memberDisplay(row.recordedBy, firmRoster.members).title}>{text}</span>
  {:else if column.id === MATCH_COLUMN_IDENTIFIERS.recordedAt}
    <span class="tabular-nums">{formatInstant(row.recordedAt)}</span>
  {:else if column.id === MATCH_COLUMN_IDENTIFIERS.withdrawnAt}
    <span class="tabular-nums">{row.withdrawnAt === null ? "" : formatInstant(row.withdrawnAt)}</span
    >
  {:else if column.id === MATCH_COLUMN_IDENTIFIERS.act}
    {#if row.withdrawnAt === null}
      <Button
        variant="ghost"
        size="sm"
        disabled={managementRefusal !== undefined}
        title={managementRefusal ?? "Take this assertion back. The item becomes outstanding again."}
        onclick={() => startWithdraw(row)}
      >
        <Undo2 class="size-16" aria-hidden="true" />
        Withdraw
      </Button>
    {/if}
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet proofList(
  figures: ReturnType<typeof proofFigures>,
  balanced: boolean | null,
  balancedTitle: string | undefined,
)}
  <DefinitionList.Root>
    {#each figures as figure (figure.identifier)}
      <DefinitionList.Row term={figure.label} empty={figure.value === null} title={figure.meaning}>
        {figure.value ?? ""}
      </DefinitionList.Row>
    {/each}
    <DefinitionList.Row
      term="Verdict"
      empty={balanced === null}
      title={balancedTitle ?? (balanced === null ? undefined : verdictMeaning(balanced))}
    >
      {balanced === null ? "" : verdictLabel(balanced)}
    </DefinitionList.Row>
    {#if balanced === null}
      <DefinitionList.Empty term="The Proof">
        The three-way proof fills in once this reconciliation has been read.
      </DefinitionList.Empty>
    {/if}
  </DefinitionList.Root>
{/snippet}

<ScreenHeader title="Reconciliation" back="trust" class="mb-24">
  {#snippet meta()}
    <span>{periodText}</span>
    {#if reconciliation !== null}
      <Masthead.MetaSeparator />
      <span>{reconciliationStandingLabel(reconciliation.status)}</span>
      <Masthead.MetaSeparator />
      <span>Opened {formatInstant(reconciliation.openedAt)}</span>
    {/if}
  {/snippet}
  {#snippet actions()}
    <Button
      variant="primary"
      disabled={closeRefusal !== undefined}
      title={closeRefusal}
      onclick={startClose}
    >
      Close Reconciliation
    </Button>
  {/snippet}
</ScreenHeader>

{#if workbench.notFound}
  <EmptyState title="No Such Reconciliation">
    This address names no reconciliation on the firm's record. It may have been opened against
    another firm, or the link may be mistyped.
  </EmptyState>
{:else if workbench.reconciliationFailure !== null}
  <FailureNotice
    failure={workbench.reconciliationFailure}
    title="The Reconciliation Could Not Be Read"
    fallback="The record itself is unaffected: nothing was changed by this failure, and every match and every figure the period carries is still on the firm's record."
    onRetry={() => workbench.retryReconciliation(fetch, data.reconciliationId)}
  />
{:else}
  <div class="flex flex-col gap-24">
    <!-- THE PROOF — the three-way proof, and for a closed period what the firm attested to beside
         what the same period comes to now. -->
    <Card.Root>
      <Card.Header>
        <Card.Title>The Proof</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-16">
        {#if reconciliation !== null && reconciliation.frozenProof !== null}
          <div class="grid gap-16 lg:grid-cols-2">
            <div class="flex flex-col gap-8">
              <FieldLabel as="p">What the Firm Attested To</FieldLabel>
              {@render proofList(
                proofFigures(reconciliation.frozenProof, money),
                reconciliation.frozenProof.balanced,
                FROZEN_PROOF_MEANING,
              )}
            </div>
            <div class="flex flex-col gap-8">
              <FieldLabel as="p">As It Stands Now</FieldLabel>
              {@render proofList(proofFigures(proof, money), proof?.balanced ?? null, undefined)}
            </div>
          </div>
        {:else}
          {@render proofList(proofFigures(proof, money), proof?.balanced ?? null, undefined)}
        {/if}

        <div class="flex flex-col gap-8">
          <FieldLabel as="p">Disagreements</FieldLabel>
          <DefinitionList.Root>
            {#each disagreementRows(proof, money) as row (row.identifier)}
              <DefinitionList.Row term={row.label} title={row.meaning}>
                {row.difference}
              </DefinitionList.Row>
            {/each}
            {#if disagreementRows(proof, money).length === 0}
              <DefinitionList.Empty term="Disagreements">
                {proof === null
                  ? "Which legs disagree, and by how much, is stated once this reconciliation has been read."
                  : "No leg of the proof disagrees for this period."}
              </DefinitionList.Empty>
            {/if}
          </DefinitionList.Root>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- THE TWO SIDES — the bank's unaccounted lines, the firm's unaccounted entries, and the one
         act between them. -->
    <Card.Root>
      <Card.Header>
        <Card.Title>The Two Sides</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-16">
        {#if matchFailure !== null}
          <FailureNotice
            failure={matchFailure.failure}
            title="No Match Was Recorded"
            fallback={matchFailure.fallback}
            whenSilent={matchFailure.whenSilent}
            onRetry={() => void recordMatch()}
          />
        {/if}

        <div class="flex flex-wrap items-center justify-end gap-8">
          <Button
            variant="primary"
            disabled={matchRefusalText !== undefined || matching}
            title={matchRefusalText}
            onclick={() => void recordMatch()}
          >
            <Link2 class="size-16" aria-hidden="true" />
            {matching ? "Matching" : "Match"}
          </Button>
        </div>

        {#if workbench.suggestionsFailure !== null}
          <FailureNotice
            failure={workbench.suggestionsFailure}
            title="The Two Sides Could Not Be Read"
            fallback="What this period has not accounted for is not shown. Nothing was matched or unmatched by this failure."
            onRetry={() => workbench.reread(fetch, data.reconciliationId)}
          />
        {:else}
          <div class="grid gap-16 xl:grid-cols-2">
            <div class="flex min-w-0 flex-col gap-8">
              <FieldLabel as="p">Unmatched Statement Lines</FieldLabel>
              <DataTable.Grid
                grid={lineGrid}
                caption="The statement lines this reconciliation has not accounted for"
                loading={workbench.suggestions === null}
                density="compact"
              />
              <DataTable.GridFooter grid={lineGrid} />
            </div>

            <div class="flex min-w-0 flex-col gap-8">
              <FieldLabel as="p">Outstanding Recorded Items</FieldLabel>
              <DataTable.Grid
                grid={itemGrid}
                cell={itemCell}
                caption="The entries the firm recorded that no statement line clears"
                loading={workbench.suggestions === null}
                density="compact"
              />
              <DataTable.GridFooter grid={itemGrid} />
            </div>
          </div>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- MATCHES — every assertion made on this period, withdrawn ones included. -->
    <Card.Root>
      <Card.Header>
        <Card.Title>Matches</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-8">
        {#if workbench.matchesFailure !== null}
          <FailureNotice
            failure={workbench.matchesFailure}
            title="The Matches Could Not Be Read"
            fallback="What has been matched on this period is not shown. The record itself is unaffected."
            onRetry={() => workbench.reread(fetch, data.reconciliationId)}
          />
        {:else}
          <DataTable.Grid
            grid={matchGrid}
            cell={matchCell}
            caption="Every match recorded on this reconciliation"
            loading={workbench.matches === null}
            density="compact"
          />
          <DataTable.GridFooter grid={matchGrid} />
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
{/if}

<ReconciliationCloseDialog
  bind:open={closeOpen}
  reconciliationId={data.reconciliationId}
  {proof}
  {periodText}
  unmatchedLineCount={unmatchedLines.length}
  unmatchedItemCount={outstandingItems.length}
  sentence={close.sentence}
  commitRefusal={closeRefusal}
  submissionKey={closeSubmissionKey}
  onClosed={recordedSomething}
/>

<ReconciliationWithdrawMatchDialog
  bind:open={withdrawOpen}
  reconciliationId={data.reconciliationId}
  match={withdrawingMatch}
  {money}
  submissionKey={withdrawSubmissionKey}
  onWithdrawn={recordedSomething}
/>
