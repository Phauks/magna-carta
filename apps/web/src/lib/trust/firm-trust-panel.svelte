<script lang="ts">
  /*
   * What the firm's Trust screen says about one account, beside the register.
   *
   * THE STRUCTURE STANDS BEFORE THE DATA DOES. Every section renders its own frame — the terms of
   * its definition list, its heading, its acts — from the moment an account is selected, and fills
   * in as each read lands. A panel that rendered nothing until six reads had all returned would
   * leave a reader looking at blank space with no way to tell a slow read from an empty account,
   * and no way to see that a section they expected is missing.
   *
   * SIX SECTIONS, FIVE OF THEM ABOUT THIS ACCOUNT AND ONE ABOUT THE FIRM. The queue, the position,
   * the reconciliations, the statements and the cushion all move when the selection moves. The
   * authorization posture does not: it is one rule for every account the firm holds, and the
   * section says so in its own line rather than leaving a reader to infer that changing it here
   * would change it only here.
   *
   * EACH READ FAILS ON ITS OWN. A firm whose statements cannot be read still has an approval queue
   * somebody owes an answer to, so a failed read puts one line in its own section and leaves the
   * rest of the panel standing. The register behind the panel is unaffected either way.
   *
   * WHAT IS DESIGNED AND NOT SERVED RENDERS ANYWAY, disabled and marked: reconciling a period,
   * recording or importing a statement, and the three cushion acts. A reader sees the shape of what
   * is coming and can never mistake it for working. What waits on what is in firm-trust-gaps.ts.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Accordion from "@magna-carta/design-system/accordion";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { SoonAffordance, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import * as DetailsPanel from "$lib/details-panel/index.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
  import {
    trustAccountLabel,
    type TrustAccountListing,
    type TrustPendingRequest,
  } from "./trust-api.ts";
  import { memberDisplay } from "./trust-member-names.ts";
  import PendingRequest from "./pending-request.svelte";
  import type { FirmTrust } from "./firm-trust.svelte.ts";
  import {
    postureSentence,
    postureVersionText,
    queueInOrder,
    reconciliationRows,
    statementsInOrder,
    type TrustQueueViewer,
    type TrustRequestVerb,
  } from "./firm-trust-model.ts";
  import { firmTrustGapReason, type FirmTrustGapName } from "./firm-trust-gaps.ts";
  import {
    CUSHION_NOT_OPENED,
    FROZEN_PROOF_MEANING,
    IOLTA_MEANING,
    JURISDICTION_NOT_RECORDED,
    JURISDICTION_NOT_RECORDED_MEANING,
    NO_CUSHION_MOVEMENTS,
    NO_RECONCILIATIONS,
    NO_STATEMENTS,
    QUEUE_EMPTY,
    accountStandingLabel,
    accountStandingMeaning,
    accountStandingTone,
    balancedLabel,
    cushionMovementLabel,
    dayText,
    ioltaLabel,
    reconciliationStandingLabel,
    statementPeriodText,
    statementSourceLabel,
  } from "./firm-trust-vocabulary.ts";

  let {
    account,
    accounts,
    trust,
    viewer,
    members,
    officeName,
    money,
    currency,
    postureRefusal,
    onLetGo,
    onDecide,
    onChangePosture,
  }: {
    /** The account the panel is speaking for, or null while the reader has selected none. */
    account: TrustAccountListing | null;
    /** The whole roster, for the face the panel shows when nothing is selected. */
    accounts: readonly TrustAccountListing[];
    /** Every read this panel renders, each with its own absence and its own failure. */
    trust: FirmTrust;
    viewer: TrustQueueViewer;
    /** The firm's roster, for turning a user identifier into a name. Null while it is being read. */
    members: readonly FirmMemberSummary[] | null;
    officeName: (locationId: string) => string | null;
    money: (amountMinor: number) => string;
    currency: string;
    /** Why the posture cannot be changed by this reader, or undefined while it can. */
    postureRefusal: string | undefined;
    onLetGo: () => void;
    /** A verb was pressed on a request: the screen opens the panel that asks for it. */
    onDecide: (verb: TrustRequestVerb, request: TrustPendingRequest) => void;
    onChangePosture: () => void;
  } = $props();

  const queue = $derived(queueInOrder(trust.requests ?? []));
  const statements = $derived(statementsInOrder(trust.statements ?? []));
  const reconciliations = $derived(
    reconciliationRows(trust.reconciliations ?? [], trust.statements ?? []),
  );
  const posture = $derived(trust.policy?.current ?? null);
  const postureHistory = $derived(trust.policy?.history ?? []);

  const openAccounts = $derived(accounts.filter((entry) => entry.status === "open").length);

  /* Who set the version in force, and when, where the shipped default names neither. */
  const postureSetBy = $derived(posture === null ? null : posture.setBy);
  const postureSetAt = $derived(posture === null ? null : posture.setAt);

  /** One member identifier as a name where the roster can say, and as itself where it cannot. */
  const asMember = (identifier: string) => memberDisplay(identifier, members);

  /** What the Balance row says instead of a figure nothing serves: in the row, not on a hover. */
  const balanceWaitsOn = soonDependencySentence(firmTrustGapReason("accountBalance"));

  /*
   * Whether the posture's earlier versions stand open. It defaults to open, because the reason a
   * history is exhaustive is that omissions read as health, and it is remembered per browser so a
   * reader who folded it once does not fold it on every visit.
   */
  const historyFold = createPersistedPreference(
    stringUnionPreference(
      "magna-carta-trust-posture-history",
      ["open", "closed"] as const,
      "open",
    ),
  );
  const HISTORY_FOLD_VALUE = "posture-history";

  /*
   * Why the Change control cannot be pressed, including while the rule itself is still arriving. A
   * control disabled with nothing to say is a control a reader reads as broken.
   */
  const changeRefusal = $derived(
    postureRefusal ??
      (trust.policy === null ? "Reading the firm's authorization posture." : undefined),
  );
</script>

{#snippet failureLine(sentence: string)}
  <Alert.Root variant="warning">
    <Alert.Description>{sentence}</Alert.Description>
  </Alert.Root>
{/snippet}

{#snippet soonAct(gap: FirmTrustGapName, label: string)}
  <SoonAffordance reason={firmTrustGapReason(gap)} reasonPlacement="line">
    {#snippet control(soon)}
      <Button variant="secondary" size="sm" {...soon}>{label}</Button>
    {/snippet}
  </SoonAffordance>
{/snippet}

<DetailsPanel.Root label="Trust account details">
  {#if account === null}
    <DetailsPanel.Header>
      <DetailsPanel.Title>The Firm's Trust</DetailsPanel.Title>
      <DetailsPanel.Subtitle>
        Select an account to see its queue, its statements and its reconciliations.
      </DetailsPanel.Subtitle>
    </DetailsPanel.Header>
  {:else}
    <DetailsPanel.Header>
      <DetailsPanel.Title>{account.name}</DetailsPanel.Title>
      <DetailsPanel.Subtitle>{trustAccountLabel(account)}</DetailsPanel.Subtitle>
      {#snippet actions()}
        <DetailsPanel.Close
          label="Let go of this account and show the firm's own summary"
          onclick={onLetGo}
        />
      {/snippet}
    </DetailsPanel.Header>
  {/if}

  <DetailsPanel.Body>
    {#if account === null}
      <DetailsPanel.Section label="The Roster">
        <!-- Counts are always answerable, so they are facts rather than a list that can be empty:
             a firm with no account has three zeroes and a sentence, not three blanks. -->
        <DetailsPanel.Facts>
          <DetailsPanel.Fact label="Accounts" value={String(accounts.length)} />
          <DetailsPanel.Fact label="Open" value={String(openAccounts)} />
          <DetailsPanel.Fact label="Closed" value={String(accounts.length - openAccounts)} />
        </DetailsPanel.Facts>
        {#if accounts.length === 0}
          <DefinitionList.Root>
            <DefinitionList.Empty term="The Roster">
              The firm holds no trust account yet.
            </DefinitionList.Empty>
          </DefinitionList.Root>
        {/if}
      </DetailsPanel.Section>
    {:else}
      <!-- AWAITING APPROVAL — oldest first: the request that has waited longest is the one
           somebody owes an answer. -->
      <DetailsPanel.Section label="Awaiting Approval">
        <LoadingRegion
          loading={trust.requests === null && trust.requestsFailure === null}
          label="Reading what is waiting on this account"
          failed={trust.requestsFailure !== null}
        >
          {#snippet failure()}
            {@render failureLine(
              "The approval queue could not be read, so what is waiting is not shown. Nothing was decided.",
            )}
          {/snippet}

          {#each queue as request (request.id)}
            <!-- The same component the matter's own Trust section renders, with the Matter row on:
                 this queue spans the firm, so which matter a payment stands against is the fact a
                 reader here most needs. -->
            <PendingRequest {request} {viewer} {members} {money} showMatter {onDecide} />
          {:else}
            <DefinitionList.Root>
              <DefinitionList.Row term="Amount" empty />
              <DefinitionList.Row term="Payee" empty />
              <DefinitionList.Row term="Requested By" empty />
              <DefinitionList.Empty>{QUEUE_EMPTY}</DefinitionList.Empty>
            </DefinitionList.Root>
          {/each}
        </LoadingRegion>
      </DetailsPanel.Section>

      <!-- POSITION — what the account IS is a run of facts, the way every money details panel
           states one. The balance stands beneath them as a row that renders and says, in the row,
           that it cannot be filled: nothing serves an account's balance as it stands today, and
           adding up reconciliations to guess one would put a figure about client money on screen
           that no route ever stated. -->
      <DetailsPanel.Section label="Position">
        <DetailsPanel.Facts>
          <DetailsPanel.Fact label="Currency" value={account.currency} />
          <DetailsPanel.Fact
            label="Jurisdiction"
            value={account.jurisdiction ?? JURISDICTION_NOT_RECORDED}
            title={account.jurisdiction === null ? JURISDICTION_NOT_RECORDED_MEANING : undefined}
          />
          <DetailsPanel.Fact
            label="Office"
            value={officeName(account.locationId) ?? account.locationId}
          />
          <DetailsPanel.Fact label="IOLTA" value={ioltaLabel(account.iolta)} title={IOLTA_MEANING} />
          <DetailsPanel.Fact label="Standing">
            <Badge
              variant={accountStandingTone(account.status)}
              title={accountStandingMeaning(account.status)}
            >
              {accountStandingLabel(account.status)}
            </Badge>
          </DetailsPanel.Fact>
        </DetailsPanel.Facts>

        <DefinitionList.Root>
          <DefinitionList.Row term="Balance" empty />
          <DefinitionList.Empty term="Balance">{balanceWaitsOn}</DefinitionList.Empty>
        </DefinitionList.Root>
      </DetailsPanel.Section>

      <!-- RECONCILIATIONS — most recently opened first, each with the period it was run against. -->
      <DetailsPanel.Section label="Reconciliations">
        <LoadingRegion
          loading={trust.reconciliations === null && trust.reconciliationsFailure === null}
          label="Reading this account's reconciliations"
          failed={trust.reconciliationsFailure !== null}
        >
          {#snippet failure()}
            {@render failureLine(
              "This account's reconciliations could not be read, so none is shown. The record itself is unaffected.",
            )}
          {/snippet}

          {#each reconciliations as row (row.reconciliation.id)}
            {@const opener = asMember(row.reconciliation.openedBy)}
            {@const proof = row.reconciliation.frozenProof}
            <DefinitionList.Root>
              <DefinitionList.Row term="Period" empty={row.statement === null}>
                {row.statement === null ? "" : statementPeriodText(row.statement)}
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
                {row.reconciliation.closedBy === null
                  ? ""
                  : asMember(row.reconciliation.closedBy).text}
              </DefinitionList.Row>
              <DefinitionList.Row term="Closed On" empty={row.reconciliation.closedAt === null}>
                {row.reconciliation.closedAt === null
                  ? ""
                  : formatInstant(row.reconciliation.closedAt)}
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

        {@render soonAct("reconcile", "Reconcile")}
      </DetailsPanel.Section>

      <!-- STATEMENTS — most recent period first, as the institution reported it. -->
      <DetailsPanel.Section label="Statements">
        <LoadingRegion
          loading={trust.statements === null && trust.statementsFailure === null}
          label="Reading this account's bank statements"
          failed={trust.statementsFailure !== null}
        >
          {#snippet failure()}
            {@render failureLine(
              "This account's statements could not be read, so none is shown. The record itself is unaffected.",
            )}
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
              <DefinitionList.Row
                term="Reference"
                empty={statement.statementReference === null}
              >
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
          {:else}
            <DefinitionList.Root>
              <DefinitionList.Row term="Period" empty />
              <DefinitionList.Row term="Opening" empty />
              <DefinitionList.Row term="Closing" empty />
              <DefinitionList.Empty>{NO_STATEMENTS}</DefinitionList.Empty>
            </DefinitionList.Root>
          {/each}
        </LoadingRegion>

        <div class="flex flex-col gap-8">
          {@render soonAct("recordStatement", "Record Statement")}
          {@render soonAct("importStatement", "Import Statement")}
        </div>
      </DetailsPanel.Section>

      <!-- FIRM FUNDS — the firm's own money in a client trust account, which is there to bear the
           bank's service charges and nothing else. An account that never opened the carve-out is
           in good order and says so. -->
      <DetailsPanel.Section label="Firm Funds">
        <LoadingRegion
          loading={trust.cushion === null && trust.cushionFailure === null}
          label="Reading the bank-charge cushion on this account"
          failed={trust.cushionFailure !== null}
        >
          {#snippet failure()}
            {@render failureLine(
              "The bank-charge cushion could not be read, so its position is not shown. The account's client ledgers are unaffected.",
            )}
          {/snippet}

          <DefinitionList.Root>
            {#if trust.cushion?.kind === "open"}
              <DefinitionList.Row term="Balance">
                <span class="tabular-nums">{money(trust.cushion.position.balanceMinor)}</span>
              </DefinitionList.Row>
              {#each trust.cushion.position.movements as movement (movement.id)}
                <DefinitionList.Row term={cushionMovementLabel(movement.kind)}>
                  <span class="tabular-nums">{money(movement.amountMinor)}</span>
                  <span aria-hidden="true">·</span>
                  {dayText(movement.effectiveDate)}
                  {#if movement.reference !== null}
                    <span aria-hidden="true">·</span>
                    {movement.reference}
                  {/if}
                </DefinitionList.Row>
              {:else}
                <DefinitionList.Empty>{NO_CUSHION_MOVEMENTS}</DefinitionList.Empty>
              {/each}
            {:else}
              <DefinitionList.Row term="Balance" empty />
              <DefinitionList.Empty>{CUSHION_NOT_OPENED}</DefinitionList.Empty>
            {/if}
          </DefinitionList.Root>
        </LoadingRegion>

        <div class="flex flex-col gap-8">
          {@render soonAct("openCushion", "Open Cushion")}
          {@render soonAct("fundCushion", "Fund Cushion")}
          {@render soonAct("recordBankCharge", "Record Bank Charge")}
        </div>
      </DetailsPanel.Section>
    {/if}

    <!-- AUTHORIZATION POSTURE — the FIRM's rule, not this account's. It is the last section
         because it is the one a reader visits rarely and reads whole when they do. -->
    <DetailsPanel.Section label="Authorization Posture">
      <LoadingRegion
        loading={trust.policy === null && trust.policyFailure === null}
        label="Reading the firm's authorization posture"
        failed={trust.policyFailure !== null}
      >
        {#snippet failure()}
          {@render failureLine(
            "The firm's authorization posture could not be read, so the rule in force is not shown. It still governs every payment out.",
          )}
        {/snippet}

        <DefinitionList.Root>
          <DefinitionList.Row term="Rule" empty={posture === null}>
            {posture === null ? "" : postureSentence(posture, currency)}
          </DefinitionList.Row>
          <DefinitionList.Row term="Version" empty={posture === null}>
            {posture === null ? "" : postureVersionText(posture)}
          </DefinitionList.Row>
          <DefinitionList.Row term="Set By" empty={postureSetBy === null}>
            {postureSetBy === null ? "" : asMember(postureSetBy).text}
          </DefinitionList.Row>
          <DefinitionList.Row term="Set On" empty={postureSetAt === null}>
            {postureSetAt === null ? "" : formatInstant(postureSetAt)}
          </DefinitionList.Row>
          {#if posture === null}
            <DefinitionList.Empty>
              The rule in force has not been read yet.
            </DefinitionList.Empty>
          {/if}
        </DefinitionList.Root>

        {#if postureHistory.length > 0}
          <!-- The fold counts what it hides and opens by default, and the reader's answer is
               remembered: a history is exhaustive so that an omission reads as health. -->
          <Accordion.Root
            type="single"
            value={historyFold.current === "open" ? HISTORY_FOLD_VALUE : ""}
            onValueChange={(value) =>
              historyFold.set(value === HISTORY_FOLD_VALUE ? "open" : "closed")}
          >
            <Accordion.Item value={HISTORY_FOLD_VALUE}>
              <Accordion.Trigger>Earlier Versions ({postureHistory.length})</Accordion.Trigger>
              <Accordion.Content>
                <DefinitionList.Root>
                  {#each postureHistory as version (version.version)}
                    <DefinitionList.Row term={postureVersionText(version)}>
                      {postureSentence(version, currency)}
                    </DefinitionList.Row>
                  {/each}
                </DefinitionList.Root>
              </Accordion.Content>
            </Accordion.Item>
          </Accordion.Root>
        {/if}
      </LoadingRegion>

      <div class="flex">
        <Button
          variant="secondary"
          size="sm"
          disabled={changeRefusal !== undefined}
          title={changeRefusal}
          onclick={onChangePosture}
        >
          Change
        </Button>
      </div>
    </DetailsPanel.Section>
  </DetailsPanel.Body>
</DetailsPanel.Root>
