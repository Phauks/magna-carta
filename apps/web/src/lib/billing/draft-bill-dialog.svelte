<script lang="ts">
  /*
   * Opening a draft bill.
   *
   * THE CLIENT IS SHOWN, NEVER CHOSEN. An invoice belongs to one client and may bill several of that
   * client's matters; this matter's client is resolved from its own party record, so offering a
   * picker would be inviting somebody to bill the wrong person for work they did not commission.
   *
   * TWO DOORS, ONE DIALOG. A matter's Billing section already knows its matter and its client, and
   * hands both in. The firm's Billing screen stands on no matter, so there the dialog leads with the
   * matter — picked from the firm's own list, the way a new fee or cost picks its matter — and
   * resolves the client from the matter chosen, in the same window. The reader never learns two
   * ways to start a bill.
   *
   * WHAT A DRAFT IS. A working document. Nothing is asserted to anybody, no number is drawn, and no
   * work is locked — which is why the footer says so beside the control rather than after it.
   *
   * A SECOND DRAFT IS ALLOWED AND IS USUALLY A MISTAKE. Two drafts cannot claim the same entry: the
   * claim itself is the guarantee, and the second one is refused by name. The dialog says that where
   * a draft is already open, so nobody discovers it one claim at a time.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Label from "@magna-carta/design-system/label";
  import Info from "@lucide/svelte/icons/info";
  import { civilDateParts, startOfCivilMonth } from "@magna-carta/civil-time/civil-date";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import { listMatterParties } from "$lib/matters/party-api.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import { billingFailure, createInvoice } from "./billing-api.ts";
  import { clientPartyOf, type ClientParty } from "./client-party.ts";
  import { civilDatePlusDays, civilToday } from "./invoice-standing.ts";

  let {
    open = $bindable(false),
    clientEntityId = null,
    clientName = null,
    matterNumber = null,
    aDraftIsOpen = false,
    matters = null,
    mattersCapped = false,
    draftIsOpenFor,
    onOpened,
  }: {
    open?: boolean;
    /**
     * The client the matter's own party record resolves to, where the caller stands on a matter.
     * Null where it does not: the dialog then asks for the matter and resolves the client itself.
     */
    clientEntityId?: string | null;
    clientName?: string | null;
    matterNumber?: string | null;
    /** Whether this client already has a draft standing open, where the caller knows. */
    aDraftIsOpen?: boolean;
    /** The firm's matters to pick from. Given, the dialog leads with the matter. */
    matters?: readonly SheetMatter[] | null;
    /** Whether that list is a page of the record rather than all of it. */
    mattersCapped?: boolean;
    /** Whether a draft already stands open for a client the dialog resolved on its own. */
    draftIsOpenFor?: (clientEntityId: string) => boolean;
    /** The draft was opened. The register re-reads and selects it; the firm's screen goes to it. */
    onOpened: (invoiceId: string, matterId: string | null) => void;
  } = $props();

  let periodStart = $state("");
  let periodEnd = $state("");
  let failure = $state<StatedFailure | null>(null);

  // ---- the matter, where this dialog is the one that asks for it --------------------------------

  const picksItsMatter = $derived(matters !== null);
  let chosenMatterId = $state<string | null>(null);
  /** Null while nothing is chosen or the read is in flight; the party record's answer otherwise. */
  let resolvedClient = $state<ClientParty | null>(null);
  let resolvingClient = $state(false);
  let clientRefusal = $state<string | null>(null);

  const chosenMatter = $derived(
    (matters ?? []).find((matter) => matter.id === chosenMatterId) ?? null,
  );

  /*
   * The client behind the matter, read the moment a matter is picked. A matter with no client
   * party can be read and cannot be billed: the dialog says so where the matter was chosen, and
   * the commit waits rather than opening a draft against nobody.
   */
  async function pickMatter(matterId: string | null): Promise<void> {
    chosenMatterId = matterId;
    resolvedClient = null;
    clientRefusal = null;
    if (matterId === null) return;
    resolvingClient = true;
    const outcome = await listMatterParties(fetch, matterId);
    // A later pick supersedes this read; its answer is not this matter's.
    if (chosenMatterId !== matterId) return;
    resolvingClient = false;
    if (outcome.kind !== "ok") {
      clientRefusal = "This matter's parties could not be read, so its client is unknown.";
      return;
    }
    const client = clientPartyOf(outcome.value.parties);
    if (client === null) {
      clientRefusal = "This matter names no client, so there is nobody to bill.";
      return;
    }
    resolvedClient = client;
  }

  const effectiveClientId = $derived(clientEntityId ?? resolvedClient?.entityId ?? null);
  const effectiveClientName = $derived(
    clientEntityId === null ? (resolvedClient?.displayName ?? null) : clientName,
  );
  const effectiveMatterNumber = $derived(
    picksItsMatter ? (chosenMatter?.matterNumber ?? null) : matterNumber,
  );
  /*
   * The bill being opened, by the matter it is on. The separator and the "Matter" word were written
   * out here before; both belong to the design system now, so this states the parts and nothing
   * about how they are joined.
   */
  const subtitle = $derived<RecordSubject>(
    effectiveClientName === null
      ? picksItsMatter
        ? { facts: ["On the matter you choose"] }
        : {}
      : {
          reference: { kind: "Matter", number: effectiveMatterNumber },
          facts: [effectiveClientName],
        },
  );

  const draftAlreadyOpen = $derived(
    clientEntityId !== null
      ? aDraftIsOpen
      : resolvedClient !== null && (draftIsOpenFor?.(resolvedClient.entityId) ?? false),
  );

  const commitRefusal = $derived.by((): string | undefined => {
    if (!picksItsMatter) return undefined;
    if (chosenMatterId === null) return "Choose the matter this bill charges.";
    if (resolvingClient) return "Reading the matter's client.";
    if (clientRefusal !== null) return clientRefusal;
    return undefined;
  });

  // A fresh opening starts from a fresh month: the period a firm bills is almost always the one just
  // finished, and carrying the last dialog's dates into this one is how a bill gets the wrong period.
  function reset(): void {
    const today = civilToday();
    const { year, month } = civilDateParts(today);
    periodStart = startOfCivilMonth(year, month);
    periodEnd = today;
    failure = null;
    chosenMatterId = null;
    resolvedClient = null;
    resolvingClient = false;
    clientRefusal = null;
  }

  async function openDraft(): Promise<ActionOutcome> {
    failure = null;
    const client = effectiveClientId;
    if (client === null) return "refused";
    const outcome = await createInvoice(
      fetch,
      {
        clientEntityId: client,
        currency: "USD",
        billingPeriodStart: periodStart === "" ? null : periodStart,
        billingPeriodEnd: periodEnd === "" ? null : periodEnd,
      },
      // A retried open must not raise a second draft against the same client.
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      onOpened(outcome.value.invoiceId, picksItsMatter ? chosenMatterId : null);
      return "committed";
    }
    failure = billingFailure(outcome, "No draft was opened.");
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Draft a Bill"
  {subtitle}
  commitLabel="Open Draft"
  commitBusyLabel="Opening"
  {commitRefusal}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={openDraft}
>


  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Opened"
        fallback={failure.fallback}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      {#if picksItsMatter}
        <!-- First, because a bill is a fact about a client before it is a fact about a period, and
             the client comes from the matter. -->
        <div class="flex flex-col gap-4">
          <Label for="draft-bill-matter">Matter</Label>
          <MatterPicker
            matters={matters ?? []}
            value={chosenMatterId}
            inputId="draft-bill-matter"
            disabled={busy}
            capped={mattersCapped}
            title="The matter this bill charges. Its client is read from the matter's own parties."
            onpick={(picked) => void pickMatter(picked)}
          />
          {#if clientRefusal !== null}
            <Alert.Root variant="warning">
              <Alert.Description>{clientRefusal}</Alert.Description>
            </Alert.Root>
          {/if}
        </div>
      {/if}

      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          A bill belongs to one client and can cover several of their matters. The client comes from this matter's parties.
        </span>
      </p>

      <div class="grid gap-12 sm:grid-cols-2">
        <!-- The picker's label and field are siblings with no wrapper of their own, so each one
             needs a track to itself or the label lands in the next column. -->
        <div class="flex flex-col gap-8">
          <DatePicker
            label="Billing Period Starts"
            value={civilDateValue(periodStart)}
            onValueChange={(next) => (periodStart = civilDateTextOrEmpty(next))}
            disabled={busy}
          />
        </div>
        <div class="flex flex-col gap-8">
          <DatePicker
            label="Billing Period Ends"
            value={civilDateValue(periodEnd)}
            onValueChange={(next) => (periodEnd = civilDateTextOrEmpty(next))}
            disabled={busy}
          />
        </div>
      </div>
      <p class="text-xs text-text-muted">
        The period the bill covers. The issue and due dates are set when it's finalized, from {civilToday()} and {civilDatePlusDays(civilToday(), 30)} by default.
      </p>

      {#if draftAlreadyOpen}
        <p class="text-xs text-status-warning-subtle-foreground">
          A draft for this client is already open. Entries on one draft can't be claimed by another.
        </p>
      {/if}

      <!-- What pressing the commit actually does. It sat in the action bar before the shell owned
           that bar; it is content rather than a control, so it reads here with the rest. -->
      <p class="text-xs text-text-subtle">
        Opens a draft: a working document, voidable, asserting nothing to anybody.
      </p>
    </div>
  {/snippet}
</ActionDialog>
