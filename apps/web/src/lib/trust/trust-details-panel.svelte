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
   */
  import { formatDate } from "@magna-carta/design-system/data-table";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { soonDependencySentence } from "@magna-carta/design-system/maturity";
  import * as DetailsPanel from "$lib/details-panel/index.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import type { TrustMatterLedger, TrustMovementRecord } from "./trust-api.ts";
  import { UNSERVED_FIGURE, flow, matterTrustSummary } from "./trust-figures.ts";
  import { gapCellTitle, gapReason } from "./trust-gaps.ts";
  import { memberDisplay } from "./trust-member-names.ts";
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
    movements,
    selected,
    money,
    unservedPositionTitle,
    onLetGo,
  }: {
    /** The ledger read, for the position the panel states with nothing selected. Null until served. */
    ledger: TrustMatterLedger | null;
    /** Every movement on the matter, for the face the panel shows with nothing selected. */
    movements: readonly TrustMovementRecord[];
    selected: readonly TrustMovementRecord[];
    money: (amountMinor: number) => string;
    /** Why a figure is a dash: which of "no account", "none chosen" or "no ledger yet" is true. */
    unservedPositionTitle: string;
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
    </DetailsPanel.Body>
  {/if}
</DetailsPanel.Root>
