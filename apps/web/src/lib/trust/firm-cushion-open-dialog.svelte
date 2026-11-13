<script lang="ts">
  /*
   * Opening the bank-charge carve-out on a trust account.
   *
   * THE CUSHION IS OPTED INTO, ONCE, PER ACCOUNT. An account that never opened one is in perfectly
   * good order, which is why the cushion is opened by an act rather than existing as a zero from the
   * day the account was opened. What it holds afterwards is the firm's own money, and it is there to
   * bear the institution's service charges and nothing else.
   *
   * THE ACCOUNT DECIDES WHETHER IT MAY BE OPENED, AND THE SERVER DECIDES THAT. A pooled
   * interest-bearing account is refused, and the refusal is shown in the server's own words: the
   * rule belongs to the jurisdiction and to the institution, and a sentence written here would be
   * this repository's guess at somebody else's rule. FailureNotice prints the problem's `detail`
   * ahead of any wording of ours, so the reader is told why by whoever actually knows.
   *
   * THE IDEMPOTENCY KEY IS MINTED WHEN THE PANEL OPENS and reused on every retry, so a submission
   * that timed out and was pressed again opens one carve-out rather than asking for a second.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { openTrustFirmFunds, type TrustAccountListing } from "./trust-api.ts";
  import { fieldRefusal } from "./trust-write-requests.ts";
  import {
    DEFAULT_CUSHION_NODE_NAME,
    readTrustCushionOpening,
    type TrustCushionOpeningEntry,
  } from "./firm-cushion-requests.ts";

  let {
    open = $bindable(false),
    account,
    onOpened,
  }: {
    open?: boolean;
    /** The account the carve-out is opened on. The control that opens this panel is refused without one. */
    account: TrustAccountListing | null;
    /** The carve-out is open: the section re-reads the cushion and the account's position. */
    onOpened: () => void;
  } = $props();

  let nodeName = $state(DEFAULT_CUSHION_NODE_NAME);
  let failure = $state<StatedFailure | null>(null);
  /** Minted on the gesture that opens the panel, reused on every retry of this one submission. */
  let submissionKey = $state("");

  function reset(): void {
    nodeName = DEFAULT_CUSHION_NODE_NAME;
    failure = null;
    submissionKey = crypto.randomUUID();
  }

  const started = $derived(nodeName !== DEFAULT_CUSHION_NODE_NAME);

  const entry = $derived<TrustCushionOpeningEntry>({
    trustAccountId: account?.id ?? "",
    nodeName,
  });
  const reading = $derived(readTrustCushionOpening(entry));

  const refusal = $derived.by((): string | undefined => {
    if (account === null) return "Select the account the cushion is opened on.";
    return reading.kind === "refused" ? reading.reason : undefined;
  });

  const subtitle = $derived<RecordSubject>({ facts: account === null ? [] : [account.name] });

  const serverProblem = $derived(failure?.failure.problem ?? null);

  async function openCushion(): Promise<ActionOutcome> {
    if (reading.kind !== "request") return "refused";
    failure = null;
    const outcome = await openTrustFirmFunds(fetch, reading.request, submissionKey);
    if (outcome.kind === "ok") {
      onOpened();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The cushion is not open: this account holds no money of the firm's.",
      "Couldn't connect. The cushion wasn't opened, and trying again won't open a second one.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Open Cushion"
  {subtitle}
  commitLabel="Open Cushion"
  commitBusyLabel="Opening"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={openCushion}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Cushion Is Not Open"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <LabelledField
        label="Name"
        hint="What the firm calls this carve-out on the ledger."
        error={fieldRefusal(serverProblem, "nodeName")}
      >
        {#snippet children({ props })}
          <Input
            {...props}
            placeholder={placeholderOf("Name")}
            disabled={busy}
            bind:value={nodeName}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}
</ActionDialog>
