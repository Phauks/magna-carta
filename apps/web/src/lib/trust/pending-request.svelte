<script lang="ts">
  /*
   * One payment out that nobody has decided yet, rendered the same way wherever it is read.
   *
   * A REQUEST IS A RECORD, SO IT STATES ITS TERMS. What it is, how much, to whom, why, by what
   * means, who raised it and when: a member deciding whether to release a client's money is
   * checking every one of those, and a one-line summary makes them open something else to find
   * three of them. The matter's Trust section had the line and the firm's screen had the list, so
   * the same request read as two different things depending on where somebody met it.
   *
   * THE VERBS ARE THE SHARED POLICY'S (trust-request-verbs.ts), never this component's: the
   * proposer takes their request back, everybody else approves or refuses it, and a reader without
   * the capability sees the same verbs disabled with the reason.
   *
   * THE MATTER ROW IS THE FIRM'S QUESTION ALONE. A matter's own section already knows which matter
   * it is, so the row stands only where the queue spans the firm — and there it says what it is
   * waiting on rather than printing the ledger node's handle at somebody.
   */
  import Button from "@magna-carta/design-system/button";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { soonDependencySentence } from "@magna-carta/design-system/maturity";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import { firmTrustGapReason } from "./firm-trust-gaps.ts";
  import { memberDisplay } from "./trust-member-names.ts";
  import { requestKindLabel, requestKindMeaning } from "./firm-trust-vocabulary.ts";
  import type { TrustPendingRequest } from "./trust-api.ts";
  import {
    requestActions,
    type TrustQueueViewer,
    type TrustRequestVerb,
  } from "./trust-request-verbs.ts";
  import { methodLabel } from "./trust-vocabulary.ts";

  let {
    request,
    viewer,
    members,
    money,
    showMatter = false,
    onDecide,
  }: {
    request: TrustPendingRequest;
    viewer: TrustQueueViewer;
    /** The firm's roster, for turning a user identifier into a name. Null while it is being read. */
    members: readonly FirmMemberSummary[] | null;
    money: (amountMinor: number) => string;
    /** Whether to say which matter this stands against: true on a queue that spans the firm. */
    showMatter?: boolean;
    onDecide: (verb: TrustRequestVerb, request: TrustPendingRequest) => void;
  } = $props();

  const requester = $derived(memberDisplay(request.requestedBy, members));
  const matterReason = soonDependencySentence(firmTrustGapReason("requestMatter"));
</script>

<div class="flex flex-col gap-8">
  <DefinitionList.Root>
    <DefinitionList.Row term="Kind" title={requestKindMeaning(request.kind)}>
      {requestKindLabel(request.kind)}
    </DefinitionList.Row>
    <DefinitionList.Row term="Amount">
      <span class="tabular-nums">{money(request.amountMinor)}</span>
    </DefinitionList.Row>
    <DefinitionList.Row term="Payee">{request.payee}</DefinitionList.Row>
    <DefinitionList.Row term="Purpose">{request.purpose}</DefinitionList.Row>
    <DefinitionList.Row term="Method">{methodLabel(request.method)}</DefinitionList.Row>
    <DefinitionList.Row term="Requested By" title={requester.title}>
      {requester.text}
    </DefinitionList.Row>
    <DefinitionList.Row term="Requested On">
      <span class="tabular-nums">{formatInstant(request.requestedAt)}</span>
    </DefinitionList.Row>
    {#if showMatter}
      <!-- The row stands and says what it waits on, in the row itself: a fact a reader cannot have
           is not something to leave on a hover. -->
      <DefinitionList.Row term="Matter" empty />
      <DefinitionList.Empty term="Matter">{matterReason}</DefinitionList.Empty>
    {/if}
  </DefinitionList.Root>

  <div class="flex flex-wrap items-center gap-8">
    {#each requestActions(request, viewer) as action (action.verb)}
      <Button
        variant={action.verb === "reject" ? "ghost" : "secondary"}
        size="sm"
        disabled={action.refusal !== undefined}
        title={action.refusal}
        onclick={() => onDecide(action.verb, request)}
      >
        {action.label}
      </Button>
    {/each}
  </div>
</div>
