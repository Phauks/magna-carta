<script lang="ts">
  /*
   * The periods of one trust account as the institution reported them, and the three acts over
   * them.
   *
   * A STATEMENT REACHES THE PLATFORM TWO WAYS AND IS ONE RECORD EITHER WAY. Entered by hand or read
   * out of the file the institution publishes, what is stored is the same period with the same
   * lines, which is why the two acts sit side by side under the list rather than in two places.
   *
   * RECONCILING IS AN ACT ON ONE PERIOD, SO IT LIVES ON THAT PERIOD'S ROW. A single control under
   * the list would have to ask which statement it meant, and the answer is already on screen: the
   * row the reader is looking at. Opening one leaves this screen for the workbench, because
   * matching lines against recorded entries is a surface of its own rather than something a details
   * panel can hold.
   */
  import Button from "@magna-carta/design-system/button";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { goto } from "$app/navigation";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import FirmTrustReadFailure from "./firm-trust-read-failure.svelte";
  import ImportStatementDialog from "./import-statement-dialog.svelte";
  import OpenReconciliationDialog from "./open-reconciliation-dialog.svelte";
  import RecordStatementDialog from "./record-statement-dialog.svelte";
  import type { FirmTrust } from "./firm-trust.svelte.ts";
  import { statementsInOrder } from "./firm-trust-model.ts";
  import { memberDisplay } from "./trust-member-names.ts";
  import type { TrustAccountListing, TrustBankStatement } from "./trust-api.ts";
  import {
    NO_STATEMENTS,
    statementPeriodText,
    statementSourceLabel,
  } from "./firm-trust-vocabulary.ts";

  let {
    account,
    trust,
    members,
    money,
    manageRefusal,
  }: {
    account: TrustAccountListing;
    /** The store the statements read lands in, with its own failure. */
    trust: FirmTrust;
    /** The firm's roster, for turning a user identifier into a name. Null while it is being read. */
    members: readonly FirmMemberSummary[] | null;
    money: (amountMinor: number) => string;
    /** Why this reader may not record, import or reconcile, or undefined while they may. */
    manageRefusal: string | undefined;
  } = $props();

  const statements = $derived(statementsInOrder(trust.statements ?? []));

  let recordOpen = $state(false);
  let importOpen = $state(false);
  let reconcileOpen = $state(false);
  /** The period a reconciliation is being opened over. The panel stands only once one is chosen. */
  let reconciling = $state<TrustBankStatement | null>(null);

  /** One member identifier as a name where the roster can say, and as itself where it cannot. */
  const asMember = (identifier: string) => memberDisplay(identifier, members);

  function recorded(): void {
    trust.reloadStatements(fetch, account.id);
  }

  function reconcile(statement: TrustBankStatement): void {
    reconciling = statement;
    reconcileOpen = true;
  }

  /* The workbench is where a period is matched and closed, so opening one goes there. */
  function opened(reconciliationId: string): void {
    void goto(`/trust/reconciliations/${encodeURIComponent(reconciliationId)}`);
  }
</script>

<LoadingRegion
  loading={trust.statements === null && trust.statementsFailure === null}
  label="Reading this account's bank statements"
  failed={trust.statementsFailure !== null}
>
  {#snippet failure()}
    {#if trust.statementsFailure !== null}
      <FirmTrustReadFailure
        failure={trust.statementsFailure}
        title="This Account's Statements Could Not Be Read"
        fallback="No period the bank reported is shown. The record itself is unaffected."
        onRetry={() => trust.reloadStatements(fetch, account.id)}
      />
    {/if}
  {/snippet}

  {#each statements as statement (statement.id)}
    {@const recorder = asMember(statement.recordedBy)}
    <DefinitionList.Root>
      <DefinitionList.Row term="Period">
        {statementPeriodText(statement)}
      </DefinitionList.Row>
      <DefinitionList.Row term="Opening">
        <span class="tabular-nums">{money(statement.openingBalanceMinor)}</span>
      </DefinitionList.Row>
      <DefinitionList.Row term="Closing">
        <span class="tabular-nums">{money(statement.closingBalanceMinor)}</span>
      </DefinitionList.Row>
      <DefinitionList.Row term="Reference" empty={statement.statementReference === null}>
        {statement.statementReference}
      </DefinitionList.Row>
      <DefinitionList.Row term="Source">
        {statementSourceLabel(statement.source)}
      </DefinitionList.Row>
      <DefinitionList.Row term="Recorded By" title={recorder.title}>
        {recorder.text}
      </DefinitionList.Row>
      <DefinitionList.Row term="Recorded On">
        <span class="tabular-nums">{formatInstant(statement.recordedAt)}</span>
      </DefinitionList.Row>
    </DefinitionList.Root>

    <div class="flex">
      <Button
        variant="secondary"
        size="sm"
        disabled={manageRefusal !== undefined}
        title={manageRefusal}
        onclick={() => reconcile(statement)}
      >
        Reconcile
      </Button>
    </div>
  {:else}
    <DefinitionList.Root>
      <DefinitionList.Row term="Period" empty />
      <DefinitionList.Row term="Opening" empty />
      <DefinitionList.Row term="Closing" empty />
      <DefinitionList.Empty>{NO_STATEMENTS}</DefinitionList.Empty>
    </DefinitionList.Root>
  {/each}
</LoadingRegion>

<div class="flex flex-wrap items-center gap-8">
  <Button
    variant="secondary"
    size="sm"
    disabled={manageRefusal !== undefined}
    title={manageRefusal}
    onclick={() => (recordOpen = true)}
  >
    Record Statement
  </Button>
  <Button
    variant="secondary"
    size="sm"
    disabled={manageRefusal !== undefined}
    title={manageRefusal}
    onclick={() => (importOpen = true)}
  >
    Import Statement
  </Button>
</div>

<RecordStatementDialog
  bind:open={recordOpen}
  trustAccountId={account.id}
  accountName={account.name}
  currency={account.currency}
  timeZone={account.timeZone}
  onRecorded={recorded}
/>

<ImportStatementDialog
  bind:open={importOpen}
  trustAccountId={account.id}
  accountName={account.name}
  currency={account.currency}
  timeZone={account.timeZone}
  onRecorded={recorded}
/>

{#if reconciling !== null}
  <OpenReconciliationDialog
    bind:open={reconcileOpen}
    statement={reconciling}
    reconciliations={trust.reconciliations ?? []}
    onOpened={opened}
  />
{/if}
