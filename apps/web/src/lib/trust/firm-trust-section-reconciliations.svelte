<script lang="ts">
  /*
   * Every reconciliation recorded on one trust account, most recently opened first.
   *
   * THE PERIOD IS THE WAY IN. A reconciliation is read and worked in the workbench, and the thing a
   * reader points at to get there is the period it was run against — never a handle, and never a
   * separate control that would have to say which row it meant.
   *
   * WHAT A CLOSED PERIOD FROZE IS NOT WHAT IS TRUE NOW, and the rows say so on the hover of the
   * Proof row: the frozen figures are what the firm attested to at the moment of closing. The
   * recomputed proof lives in the workbench, where the difference can be shown beside them.
   *
   * A RECONCILIATION WHOSE STATEMENT IS NOT AMONG THE ONES READ shows no period: the two reads are
   * independent, and a statement superseded by a later one can leave a closed reconciliation
   * pointing at a period the current listing no longer carries. That is a fact about the record
   * rather than a failed read, so the row stands with the empty mark instead of printing the
   * identifier as though it were a period.
   */
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import FirmTrustReadFailure from "./firm-trust-read-failure.svelte";
  import type { FirmTrust } from "./firm-trust.svelte.ts";
  import { reconciliationRows } from "./firm-trust-model.ts";
  import { memberDisplay } from "./trust-member-names.ts";
  import {
    FROZEN_PROOF_MEANING,
    NO_RECONCILIATIONS,
    balancedLabel,
    reconciliationStandingLabel,
    statementPeriodText,
  } from "./firm-trust-vocabulary.ts";

  let {
    trust,
    members,
    money,
  }: {
    /** The store the reconciliations and statements reads land in, each with its own failure. */
    trust: FirmTrust;
    /** The firm's roster, for turning a user identifier into a name. Null while it is being read. */
    members: readonly FirmMemberSummary[] | null;
    money: (amountMinor: number) => string;
  } = $props();

  const rows = $derived(reconciliationRows(trust.reconciliations ?? [], trust.statements ?? []));

  /** One member identifier as a name where the roster can say, and as itself where it cannot. */
  const asMember = (identifier: string) => memberDisplay(identifier, members);

  /** Where one reconciliation is read, matched and closed. */
  const workbenchHref = (reconciliationId: string): string =>
    `/trust/reconciliations/${encodeURIComponent(reconciliationId)}`;
</script>

<LoadingRegion
  loading={trust.reconciliations === null && trust.reconciliationsFailure === null}
  label="Reading this account's reconciliations"
  failed={trust.reconciliationsFailure !== null}
>
  {#snippet failure()}
    <FirmTrustReadFailure
      sentence="This account's reconciliations could not be read, so none is shown. The record itself is unaffected."
    />
  {/snippet}

  {#each rows as row (row.reconciliation.id)}
    {@const opener = asMember(row.reconciliation.openedBy)}
    {@const proof = row.reconciliation.frozenProof}
    <DefinitionList.Root>
      <DefinitionList.Row term="Period" empty={row.statement === null}>
        {#if row.statement !== null}
          <a class="underline underline-offset-2" href={workbenchHref(row.reconciliation.id)}>
            {statementPeriodText(row.statement)}
          </a>
        {/if}
      </DefinitionList.Row>
      <DefinitionList.Row term="Status">
        {reconciliationStandingLabel(row.reconciliation.status)}
      </DefinitionList.Row>
      <DefinitionList.Row term="Opened By" title={opener.title}>
        {opener.text}
      </DefinitionList.Row>
      <DefinitionList.Row term="Opened On">
        <span class="tabular-nums">{formatInstant(row.reconciliation.openedAt)}</span>
      </DefinitionList.Row>
      <DefinitionList.Row term="Closed By" empty={row.reconciliation.closedBy === null}>
        {row.reconciliation.closedBy === null ? "" : asMember(row.reconciliation.closedBy).text}
      </DefinitionList.Row>
      <DefinitionList.Row term="Closed On" empty={row.reconciliation.closedAt === null}>
        {row.reconciliation.closedAt === null ? "" : formatInstant(row.reconciliation.closedAt)}
      </DefinitionList.Row>
      <DefinitionList.Row term="Proof" empty={proof === null} title={FROZEN_PROOF_MEANING}>
        {proof === null ? "" : balancedLabel(proof.balanced)}
      </DefinitionList.Row>
      <DefinitionList.Row term="Unmatched Lines" empty={proof === null}>
        {proof === null ? "" : String(proof.unmatchedLineCount)}
      </DefinitionList.Row>
      <DefinitionList.Row term="Unmatched Items" empty={proof === null}>
        {proof === null ? "" : String(proof.unmatchedItemCount)}
      </DefinitionList.Row>
      <DefinitionList.Row term="Adjusted Bank" empty={proof === null}>
        {proof === null ? "" : money(proof.adjustedBankMinor)}
      </DefinitionList.Row>
      <DefinitionList.Row term="Book Balance" empty={proof === null}>
        {proof === null ? "" : money(proof.bookBalanceMinor)}
      </DefinitionList.Row>
      <DefinitionList.Row term="Client Ledgers" empty={proof === null}>
        {proof === null ? "" : money(proof.clientLedgerTotalMinor)}
      </DefinitionList.Row>
    </DefinitionList.Root>
  {:else}
    <DefinitionList.Root>
      <DefinitionList.Row term="Period" empty />
      <DefinitionList.Row term="Status" empty />
      <DefinitionList.Row term="Proof" empty />
      <DefinitionList.Empty>{NO_RECONCILIATIONS}</DefinitionList.Empty>
    </DefinitionList.Root>
  {/each}
</LoadingRegion>
