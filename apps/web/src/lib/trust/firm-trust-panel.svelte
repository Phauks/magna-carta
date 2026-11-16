<script lang="ts">
  /*
   * What the firm's Trust screen says about one account, beside the register.
   *
   * THE STRUCTURE STANDS BEFORE THE DATA DOES. Every section renders its own frame — the terms of
   * its definition list, its heading, its acts — from the moment an account is selected, and fills
   * in as each read lands. A panel that rendered nothing until seven reads had all returned would
   * leave a reader looking at blank space with no way to tell a slow read from an empty account,
   * and no way to see that a section they expected is missing.
   *
   * SEVEN SECTIONS, SIX OF THEM ABOUT THIS ACCOUNT AND ONE ABOUT THE FIRM. The queue, the position,
   * the reconciliations, the statements, the cushion and the unclaimed-funds diligence all move
   * when the selection moves. The authorization posture does not: it is one rule for every account
   * the firm holds, and the section says so in its own line rather than leaving a reader to infer
   * that changing it here would change it only here.
   *
   * EACH READ FAILS ON ITS OWN. A firm whose statements cannot be read still has an approval queue
   * somebody owes an answer to, so a failed read stands inside its own section — through the one
   * failure device, which carries the whole failure record, the Error ID and the way to ask again —
   * and leaves the rest of the panel standing. The register behind the panel is unaffected either
   * way.
   *
   * EACH SECTION IS ITS OWN COMPONENT WHERE IT CARRIES ACTS OF ITS OWN. A section with a list, a
   * failure, an empty state and two or three panels behind its controls is a file's worth of
   * reading on its own, and the panel's job is the ARRANGEMENT — which sections there are, in what
   * order, and which of them speak for the account rather than for the firm. Everything a section
   * renders still flows from the one store the screen reads into.
   */
  import Button from "@magna-carta/design-system/button";
  import * as Accordion from "@magna-carta/design-system/accordion";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
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
  import FirmTrustReadFailure from "./firm-trust-read-failure.svelte";
  import FirmTrustSectionCushion from "./firm-trust-section-cushion.svelte";
  import FirmTrustSectionPosition from "./firm-trust-section-position.svelte";
  import FirmTrustSectionReconciliations from "./firm-trust-section-reconciliations.svelte";
  import FirmTrustSectionStatements from "./firm-trust-section-statements.svelte";
  import UnclaimedFundsSection from "./unclaimed-funds-section.svelte";
  import type { FirmTrust } from "./firm-trust.svelte.ts";
  import {
    postureSentence,
    postureVersionText,
    queueInOrder,
    type TrustQueueViewer,
    type TrustRequestVerb,
  } from "./firm-trust-model.ts";
  import { QUEUE_EMPTY } from "./firm-trust-vocabulary.ts";

  let {
    account,
    accounts,
    trust,
    viewer,
    members,
    officeName,
    money,
    currency,
    manageRefusal,
    firmFundsRefusal,
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
    /**
     * Why this reader may not record, import, reconcile or work a diligence file, or undefined
     * while they may. One capability governs all of them, so it is one sentence read off the
     * session once by the screen: a section working out its own would be a second answer to the
     * same question, and the two would drift.
     */
    manageRefusal: string | undefined;
    /** Why this reader may not act on the bank-charge cushion, or undefined while they may. */
    firmFundsRefusal: string | undefined;
    /** Why the posture cannot be changed by this reader, or undefined while it can. */
    postureRefusal: string | undefined;
    onLetGo: () => void;
    /** A verb was pressed on a request: the screen opens the panel that asks for it. */
    onDecide: (verb: TrustRequestVerb, request: TrustPendingRequest) => void;
    onChangePosture: () => void;
  } = $props();

  const queue = $derived(queueInOrder(trust.requests ?? []));
  const posture = $derived(trust.policy?.current ?? null);
  const postureHistory = $derived(trust.policy?.history ?? []);

  const openAccounts = $derived(accounts.filter((entry) => entry.status === "open").length);

  /* Who set the version in force, and when, where the shipped default names neither. */
  const postureSetBy = $derived(posture === null ? null : posture.setBy);
  const postureSetAt = $derived(posture === null ? null : posture.setAt);

  /** One member identifier as a name where the roster can say, and as itself where it cannot. */
  const asMember = (identifier: string) => memberDisplay(identifier, members);

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
          label="Reading payments waiting on this account"
          failed={trust.requestsFailure !== null}
        >
          {#snippet failure()}
            {#if trust.requestsFailure !== null}
              <FirmTrustReadFailure
                failure={trust.requestsFailure}
                title="The Approval Queue Could Not Be Read"
                fallback="Payments waiting on this account couldn't be loaded. Nothing was decided."
                onRetry={() => trust.reloadQueue(fetch, account.id)}
              />
            {/if}
          {/snippet}

          {#each queue as request (request.id)}
            <!-- The same component the matter's own Trust section renders, with the Matter row on:
                 this queue spans the firm, so which matter a payment stands against is the fact a
                 reader here most needs, and the row is the way through to that matter's ledger. -->
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

      <!-- POSITION — what the account IS, and what it holds today. -->
      <DetailsPanel.Section label="Position">
        <FirmTrustSectionPosition {account} {trust} {officeName} {money} />
      </DetailsPanel.Section>

      <!-- RECONCILIATIONS — most recently opened first, each linking to its own workbench. -->
      <DetailsPanel.Section label="Reconciliations">
        <FirmTrustSectionReconciliations {account} {trust} {members} {money} />
      </DetailsPanel.Section>

      <!-- CHECKS — the account's own screen for printing the checks its payments wait on. -->
      <DetailsPanel.Section label="Checks">
        <div class="flex flex-wrap gap-8">
          <Button
            variant="secondary"
            size="sm"
            href={`/trust/checks?account=${encodeURIComponent(account.id)}`}
          >
            Open Checks
          </Button>
        </div>
      </DetailsPanel.Section>

      <!-- STATEMENTS — most recent period first, as the institution reported it, with the acts
           that record one and the act that reconciles it. -->
      <DetailsPanel.Section label="Statements">
        <FirmTrustSectionStatements {account} {trust} {members} {money} {manageRefusal} />
      </DetailsPanel.Section>

      <!-- FIRM FUNDS — the firm's own money in a client trust account, which is there to bear the
           bank's service charges and nothing else. An account that never opened the carve-out is
           in good order and says so. -->
      <DetailsPanel.Section label="Firm Funds">
        <FirmTrustSectionCushion {account} {trust} {money} {firmFundsRefusal} />
      </DetailsPanel.Section>

      <!-- UNCLAIMED FUNDS — client money nobody has come for, and the diligence over it. Dormancy
           is a comparison against a window the reader states, so the section asks for one. -->
      <DetailsPanel.Section label="Unclaimed Funds">
        <UnclaimedFundsSection
          trustAccountId={account.id}
          currency={account.currency}
          timeZone={account.timeZone}
          {members}
          {money}
          {manageRefusal}
        />
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
          {#if trust.policyFailure !== null}
            <FirmTrustReadFailure
              failure={trust.policyFailure}
              title="The Authorization Posture Could Not Be Read"
              fallback="The rule in force is not shown. It still governs every payment out of a client ledger."
              onRetry={() => trust.reloadPolicy(fetch)}
            />
          {/if}
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
