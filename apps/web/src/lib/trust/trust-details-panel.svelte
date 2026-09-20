<script lang="ts">
  /*
   * The trust ledger's details panel: what its three faces say, over the shared panel shell.
   *
   * The shell ($lib/details-panel) carries the frame, the header grammar and the ruled runs of
   * facts. What stays here is what only Trust knows: that a movement is named by its kind with its
   * purpose underneath, that the money reads on the side it went, and that who released it and on
   * what footing is the fact a reader of client money comes to check.
   *
   * NO VERBS. A movement that reached the ledger is a fact and nothing acts on it: there is no
   * record window to open, no edit and no void, so the panel carries no buttons rather than a row
   * of disabled ones. The one handle that will open somewhere, the disbursement request a payment
   * was approved from, is stated as the handle it is and says what its opening waits on.
   *
   * HISTORY STANDS EMPTY RATHER THAN BEING ABSENT. What happened to a movement after it was written
   * down is a question a reader of client money asks, and no route answers it yet — so the section
   * renders with its own structure and says inside it what it is waiting on, which is how a reader
   * learns the answer is coming rather than that nobody thought of the question.
   *
   * SEVERAL SELECTED SAYS WHAT THEY COME TO. No verb acts on a selection, but the sum of what came
   * in and went out across a picked range is a real question, so the selection face answers it.
   *
   * THE APPROVAL QUEUE IS A FACE OF THIS PANEL, NOT A BAND ABOVE THE LIST. A payment out that
   * nobody has decided yet is a record with terms — amount, payee, purpose, method, who raised it —
   * and reading it is the panel's job on every other record this surface holds. So the
   * no-selection face carries the queue, in the same card and under the same verb policy as the
   * firm's own Trust screen (pending-request.svelte, trust-request-verbs.ts), and the ledger's
   * notices band keeps only the count and the way here. The dialogs each verb opens stay with the
   * ledger, which is where one answer's idempotency key is held.
   */
  import { formatDate } from "@magna-carta/design-system/data-table";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { soonDependencySentence } from "@magna-carta/design-system/maturity";
  import * as DetailsPanel from "$lib/details-panel/index.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import {
    trustAccountLabel,
    type TrustAccountListing,
    type TrustMatterLedger,
    type TrustMovementRecord,
    type TrustPendingRequest,
  } from "./trust-api.ts";
  import { UNSERVED_FIGURE, flow, matterTrustSummary } from "./trust-figures.ts";
  import { QUEUE_EMPTY } from "./firm-trust-vocabulary.ts";
  import { gapCellTitle, gapReason } from "./trust-gaps.ts";
  import { memberDisplay } from "./trust-member-names.ts";
  import PendingRequest from "./pending-request.svelte";
  import type { TrustQueueViewer, TrustRequestVerb } from "./trust-request-verbs.ts";
  import {
    authorizedByText,
    authorizedByTitle,
    basisLabel,
    counterpartyText,
    direction,
    kindLabel,
    kindSentence,
    methodLabel,
  } from "./trust-vocabulary.ts";

  let {
    ledger,
    account,
    movements,
    selected,
    money,
    unservedPositionTitle,
    pendingRequests,
    pendingRefusal = null,
    viewer,
    members,
    onDecide,
    onLetGo,
  }: {
    /** The ledger read, for the position the panel states with nothing selected. Null until served. */
    ledger: TrustMatterLedger | null;
    /** The account this section is reading against, which the no-selection face names. */
    account: TrustAccountListing | null;
    /** Every movement on the matter, for the face the panel shows with nothing selected. */
    movements: readonly TrustMovementRecord[];
    selected: readonly TrustMovementRecord[];
    money: (amountMinor: number) => string;
    /** Why a figure is a dash: which of "no account", "none chosen" or "no ledger yet" is true. */
    unservedPositionTitle: string;
    /** The payments out of this matter's ledger that nobody has decided yet. */
    pendingRequests: readonly TrustPendingRequest[];
    /** What to say where the queue itself could not be read. */
    pendingRefusal?: string | null;
    /** Who is reading, so their own request offers Withdraw rather than Approve and Reject. */
    viewer: TrustQueueViewer;
    /** The firm's roster, for turning a user identifier into a name. Null while it is being read. */
    members: readonly FirmMemberSummary[] | null;
    /** A verb was pressed: the ledger opens the panel that asks for it. */
    onDecide: (verb: TrustRequestVerb, request: TrustPendingRequest) => void;
    onLetGo: () => void;
  } = $props();

  const ownNode = $derived(ledger?.trustLedgerNodeId ?? null);
  const sole = $derived(selected.length === 1 ? (selected[0] ?? null) : null);
  const summary = $derived(matterTrustSummary(ledger, movements));
  const selection = $derived(flow(selected, ownNode));

  /** What the History section says until an endpoint serves a movement's recorded events. */
  const historyWaitsOn = soonDependencySentence(gapReason("history"));

  function figureText(amountMinor: number | null): string {
    return amountMinor === null ? UNSERVED_FIGURE : money(amountMinor);
  }
</script>

<DetailsPanel.Root label="Trust movement details">
  {#if sole !== null}
    <DetailsPanel.Header>
      <DetailsPanel.Title title={kindSentence(sole.kind)}>{kindLabel(sole.kind)}</DetailsPanel.Title>
      <DetailsPanel.Subtitle>{sole.purpose}</DetailsPanel.Subtitle>
      {#snippet actions()}
        <DetailsPanel.Close
          label="Let go of this movement and show the matter's position"
          onclick={onLetGo}
        />
      {/snippet}
    </DetailsPanel.Header>

    <DetailsPanel.Body>
      <DetailsPanel.Facts ruled>
        <DetailsPanel.Fact label="Date" value={formatDate(sole.effectiveDate)} />
        <DetailsPanel.Fact
          label={direction(sole, ownNode) === "in" ? "In" : "Out"}
          value={money(sole.amountMinor)}
        />
        <DetailsPanel.Fact label="Method" value={methodLabel(sole.method)} />
        <DetailsPanel.Fact label="Reference" value={sole.reference ?? UNSERVED_FIGURE} />
        <DetailsPanel.Fact label="Counterparty" value={counterpartyText(sole, ownNode)} />
        {@const recorder = memberDisplay(sole.recordedBy, firmRoster.members)}
        <DetailsPanel.Fact label="Recorded By" value={recorder.text} title={recorder.title} />
        {#if sole.authorizedBy === null}
          <DetailsPanel.Fact
            label="Authorized By"
            value={authorizedByText(sole)}
            title={authorizedByTitle(sole)}
          />
        {:else}
          {@const authorizer = memberDisplay(sole.authorizedBy, firmRoster.members)}
          <DetailsPanel.Fact
            label="Authorized By"
            value={authorizer.text}
            title={authorizer.title ?? authorizedByTitle(sole)}
          />
        {/if}
        {#if sole.authorizationBasis !== null}
          <DetailsPanel.Fact label="Footing" value={basisLabel(sole.authorizationBasis)} />
        {/if}
        <DetailsPanel.Fact label="Recorded At" value={formatInstant(sole.recordedAt)} />
        {#if sole.disbursementRequestId !== null}
          <DetailsPanel.Fact
            label="Disbursement Request"
            value={sole.disbursementRequestId}
            title={gapCellTitle("disbursementRequest")}
          />
        {/if}
        <DetailsPanel.Fact label="Ledger Entry" value={sole.ledgerEntryId} />
      </DetailsPanel.Facts>

      <DetailsPanel.Section label="History">
        <DefinitionList.Root>
          <DefinitionList.Row term="Event" empty />
          <DefinitionList.Row term="By" empty />
          <DefinitionList.Row term="On" empty />
          <DefinitionList.Empty term="History">{historyWaitsOn}</DefinitionList.Empty>
        </DefinitionList.Root>
      </DetailsPanel.Section>
    </DetailsPanel.Body>
  {:else if selected.length > 1}
    <DetailsPanel.Header>
      <DetailsPanel.Title>{selected.length} Movements Selected</DetailsPanel.Title>
      <DetailsPanel.Subtitle>What the selection comes to</DetailsPanel.Subtitle>
      {#snippet actions()}
        <DetailsPanel.Close
          label="Let go of all {selected.length} selected movements"
          onclick={onLetGo}
        />
      {/snippet}
    </DetailsPanel.Header>
    <DetailsPanel.Body>
      <DetailsPanel.Facts>
        <DetailsPanel.Fact label="In" value={money(selection.inMinor)} />
        <DetailsPanel.Fact label="Out" value={money(selection.outMinor)} />
        <DetailsPanel.Fact label="Net" value={money(selection.inMinor - selection.outMinor)} />
      </DetailsPanel.Facts>
    </DetailsPanel.Body>
  {:else}
    <DetailsPanel.Header>
      <DetailsPanel.Title>This Matter&rsquo;s Trust Ledger</DetailsPanel.Title>
      <DetailsPanel.Subtitle>Select a movement for its details</DetailsPanel.Subtitle>
    </DetailsPanel.Header>
    <DetailsPanel.Body>
      <DetailsPanel.Facts>
        <!-- Which account this ledger is being read against. It stands here rather than in the
             chrome above the list, so a firm holding one account never spends a control saying a
             thing that has one answer, and a reader can still check it. -->
        <DetailsPanel.Fact
          label="Trust Account"
          value={account === null ? UNSERVED_FIGURE : account.name}
          title={account === null ? unservedPositionTitle : trustAccountLabel(account)}
        />
        <DetailsPanel.Fact label="Movements" value={String(summary.movementCount)} />
        <DetailsPanel.Fact
          label="Balance"
          value={figureText(summary.balanceMinor)}
          title={summary.balanceMinor === null
            ? unservedPositionTitle
            : "What this matter's trust ledger holds: every movement netted."}
        />
        <DetailsPanel.Fact
          label="Held"
          value={figureText(summary.heldMinor)}
          title={summary.heldMinor === null
            ? unservedPositionTitle
            : "The part of the balance under a disputed-funds hold."}
        />
        <DetailsPanel.Fact
          label="Available"
          value={figureText(summary.availableMinor)}
          title={summary.availableMinor === null
            ? unservedPositionTitle
            : "The balance less what is held: what a payment out or a transfer may take."}
        />
      </DetailsPanel.Facts>

      <!-- AWAITING APPROVAL — oldest first, as the server hands them over: the request that has
           waited longest is the one somebody owes an answer. The same card the firm's Trust screen
           renders, without the Matter row: this matter already knows which matter it is. -->
      <DetailsPanel.Section label="Awaiting Approval">
        {#if pendingRefusal !== null}
          <p class="text-xs text-status-warning-subtle-foreground">{pendingRefusal}</p>
        {:else}
          {#each pendingRequests as request (request.id)}
            <PendingRequest {request} {viewer} {members} {money} {onDecide} />
          {:else}
            <DefinitionList.Root>
              <DefinitionList.Row term="Amount" empty />
              <DefinitionList.Row term="Payee" empty />
              <DefinitionList.Row term="Requested By" empty />
              <DefinitionList.Empty>{QUEUE_EMPTY}</DefinitionList.Empty>
            </DefinitionList.Root>
          {/each}
        {/if}
      </DetailsPanel.Section>
    </DetailsPanel.Body>
  {/if}
</DetailsPanel.Root>
