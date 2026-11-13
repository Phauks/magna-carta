<script lang="ts">
  /*
   * Letting a payment out of a client ledger go.
   *
   * IT IS A QUESTION, SO IT TRAPS THE DECISION. Approving posts the movement in the same write:
   * money leaves the account and the client's ledger is reduced, and neither is undone by a further
   * press. So the panel is a confirm rather than a form — an alertdialog, no corner dismiss, no
   * dismissal on a stray press outside — and it states the amount and the payee, which are the two
   * facts somebody approving is actually checking.
   *
   * THE SERVER IS THE AUTHORITY ON WHO MAY. The approver is never the proposer, and the firm's
   * posture may require the authority capability besides; this panel refuses only what it can see
   * (the reader's own trust permission) and shows the route's own words for everything else.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { approveTrustRequest, type TrustPendingRequest } from "./trust-api.ts";
  import { methodLabel } from "./trust-vocabulary.ts";

  let {
    open = $bindable(false),
    request,
    matterNumber,
    money,
    requestedByName,
    submissionKey,
    onApproved,
  }: {
    open?: boolean;
    /** The request being answered. Null only in the moment before the panel is opened. */
    request: TrustPendingRequest | null;
    matterNumber: string | null;
    money: (amountMinor: number) => string;
    /** Who proposed it, as a name where the roster can say and as the identifier where not. */
    requestedByName: string;
    /** Minted on the gesture that opened this panel and reused on every retry of this answer. */
    submissionKey: string;
    onApproved: () => void;
  } = $props();

  let failure = $state<StatedFailure | null>(null);

  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Matter", number: matterNumber },
    facts:
      request === null ? [] : [`${money(request.amountMinor)} to ${request.payee}`],
  });

  async function approve(): Promise<ActionOutcome> {
    if (request === null) return "refused";
    failure = null;
    const outcome = await approveTrustRequest(fetch, request.id, submissionKey);
    if (outcome.kind === "ok") {
      onApproved();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "Nothing was released: the request is still waiting on a decision.",
      "Couldn't connect. Nothing was released, and the request is still waiting for a decision.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="confirm"
  heading="Approve Payment Out"
  {subtitle}
  commitLabel="Approve"
  commitBusyLabel="Approving"
  commitRefusal={request === null ? "No request is open." : undefined}
  onCommit={approve}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Released"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields()}
    {#if request !== null}
      <DefinitionList.Root>
        <DefinitionList.Row term="Amount">
          <span class="tabular-nums">{money(request.amountMinor)}</span>
        </DefinitionList.Row>
        <DefinitionList.Row term="Payee">{request.payee}</DefinitionList.Row>
        <DefinitionList.Row term="Purpose">{request.purpose}</DefinitionList.Row>
        <DefinitionList.Row term="Method">{methodLabel(request.method)}</DefinitionList.Row>
        <DefinitionList.Row term="Effective Date">
          <span class="tabular-nums">{formatDate(request.effectiveDate)}</span>
        </DefinitionList.Row>
        <DefinitionList.Row term="Requested By">{requestedByName}</DefinitionList.Row>
      </DefinitionList.Root>
    {/if}
  {/snippet}
</ActionDialog>
