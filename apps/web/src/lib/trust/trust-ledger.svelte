<script lang="ts">
  /*
   * The matter's Trust ledger: the list is the screen.
   *
   * A TRUST MOVEMENT IS CLIENT MONEY THAT MOVED. Every row here is one of three facts: a deposit
   * into this matter's trust ledger, a disbursement out of it to a payee, or a transfer between
   * two of this client's matters inside the same trust account. Each one names how the money
   * moved, why, who wrote it down and, where a release took one, who released it and on what
   * footing. Nothing on this screen is a draft, is edited or is voided: a movement that reached
   * the ledger is a fact the firm answers for, and a mistake is corrected by a further movement.
   *
   * THE SAME SURFACE AS TIME, FEES, COSTS AND BILLING. One table machinery, one details panel, one
   * money surface. What this file contributes is the columns, the words and the figures; every
   * behaviour a reader has learned on the other ledgers is the behaviour they get here. The frame
   * around the list is the money surface's, described once in apps/web/src/lib/money/CLAUDE.md.
   *
   * TWO ALTITUDES, NOT THREE. The LIST is what a person came for. The PANEL beside it is the
   * smaller details, and it opens from its own control alone: clicking a row selects it and does
   * nothing else. There is no record window, because there is nothing about one movement that the
   * panel cannot state and nothing about it anybody may change.
   *
   * EVERY READ AND WRITE NAMES A TRUST ACCOUNT, AND THE TOOLBAR IS WHERE THAT IS ANSWERED. A firm
   * holding one account never sees a control — the account's name stands as a quiet fact with its
   * bank on the hover — and a firm holding several picks, once, and is remembered. The three acts
   * that move money live beside it: the header's create control records a deposit, and Pay Out and
   * Transfer stand here. Each of them is DISABLED WITH ITS REASON rather than absent, because a
   * control that vanishes teaches nothing about why it is gone.
   *
   * A PAYMENT OUT MAY NOT BE THIS MEMBER'S TO RELEASE. The firm's authorization posture decides,
   * the server answers, and a request that is waiting stands in the notices band with the two
   * answers it takes — or, where the reader is the one who proposed it, with the way to take it
   * back. What it looks like, which verbs it offers and what each of them opens are the firm's
   * Trust screen's too, so all three are shared: pending-request.svelte, trust-request-verbs.ts,
   * and the three panels beside them. A member must meet one request, one way, wherever they are
   * standing.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import Button from "@magna-carta/design-system/button";
  import Copy from "@lucide/svelte/icons/copy";
  import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
  import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
  import { MoneySurface, type MoneySurfaceDensity } from "$lib/money/index.ts";
  import {
    RecordMenu,
    menuOf,
    oneRecordGesture,
    type RecordMenuChoice,
    type RecordMenuModel,
  } from "$lib/records/index.ts";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
  import {
    TRUST_PERMISSIONS,
    trustAccountLabel,
    type TrustAccountListing,
    type TrustDisbursementProposalAck,
    type TrustMatterLedger,
    type TrustMovementRecord,
    type TrustPendingRequest,
  } from "./trust-api.ts";
  import { trustAccountsInPickingOrder } from "./trust-account-choice.ts";
  import {
    TRUST_COLUMN_IDENTIFIERS,
    TRUST_LEDGER_INITIAL_SORT,
    trustLedgerColumns,
  } from "./trust-columns.ts";
  import TrustDetailsPanel from "./trust-details-panel.svelte";
  import DepositDialog from "./deposit-dialog.svelte";
  import DisbursementDialog from "./disbursement-dialog.svelte";
  import MatterTransferDialog from "./matter-transfer-dialog.svelte";
  import ApproveRequestDialog from "./approve-request-dialog.svelte";
  import RejectRequestDialog from "./reject-request-dialog.svelte";
  import WithdrawRequestDialog from "./withdraw-request-dialog.svelte";
  import PendingRequest from "./pending-request.svelte";
  import type { TrustRequestVerb } from "./trust-request-verbs.ts";
  import { footerFigures, ledgerCurrency } from "./trust-figures.ts";
  import { memberDisplay } from "./trust-member-names.ts";
  import { proposalPendingSentence } from "./trust-write-requests.ts";
  import {
    NO_AMOUNT_ON_THIS_SIDE,
    ROSTER_CAPPED_WARNING,
    authorizedByText,
    authorizedByTitle,
    counterpartyText,
    kindLabel,
    kindSentence,
  } from "./trust-vocabulary.ts";

  let {
    movements,
    ledger,
    loading = false,
    matterId,
    matterTitle,
    matterNumber,
    accounts,
    accountsCapped = false,
    account,
    noLedgerYet = false,
    pendingRequests,
    pendingRefusal = null,
    permissions,
    sessionUserId = null,
    onChooseAccount,
    onChanged,
  }: {
    /** Every movement on the matter, in effective-date order: that is what a trust ledger is. */
    movements: readonly TrustMovementRecord[];
    /** The ledger read the movements came from, for the position it states. Null where none yet. */
    ledger: TrustMatterLedger | null;
    loading?: boolean;
    matterId: string;
    matterTitle: string;
    matterNumber: string | null;
    /** The firm's trust accounts. Empty is a firm that has opened none. */
    accounts: readonly TrustAccountListing[];
    /** Whether that roster stopped short of the whole record. */
    accountsCapped?: boolean;
    /** The account this section is reading against, or null where nothing could be chosen. */
    account: TrustAccountListing | null;
    /** Whether this matter simply holds no ledger in that account yet. */
    noLedgerYet?: boolean;
    /** The payments out of THIS matter's ledger that nobody has decided yet. */
    pendingRequests: readonly TrustPendingRequest[];
    /** What to say where the queue itself could not be read. */
    pendingRefusal?: string | null;
    /** The reader's capabilities. Null while the session is still being read. */
    permissions: readonly string[] | null;
    /** Who is reading, so their own request offers Withdraw rather than Approve and Reject. */
    sessionUserId?: string | null;
    onChooseAccount: (accountId: string) => void;
    /** Something was written: the section re-reads rather than guessing what the server now holds. */
    onChanged: () => void;
  } = $props();

  const currency = $derived(ledgerCurrency(movements));
  const ownNode = $derived(ledger?.trustLedgerNodeId ?? null);
  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });

  /** Why a position figure is a dash, in the words of whichever fact is true of this matter now. */
  const unservedPositionTitle = $derived.by((): string => {
    if (accounts.length === 0) {
      return "The firm has not opened a trust account yet, so there is no position to state.";
    }
    if (account === null) return "No trust account is chosen, so there is no position to state.";
    if (noLedgerYet) return `This matter holds no trust ledger in ${account.name} yet.`;
    return "This matter's trust position has not been read yet.";
  });

  /* The panel's open state is the reader's, and it survives leaving the tab and coming back. */
  const panelPreference = createPersistedPreference(
    stringUnionPreference("magna-carta-trust-details-panel", ["open", "closed"] as const, "closed"),
  );
  const panelOpen = $derived(panelPreference.current === "open");

  let selectedMovements = $state<readonly TrustMovementRecord[]>([]);

  const grid = DataTable.createDataTableGrid<TrustMovementRecord>({
    columns: () => trustLedgerColumns(currency, ownNode, firmRoster.members),
    rows: () => movements,
    rowKey: (movement) => movement.id,
    initialSort: TRUST_LEDGER_INITIAL_SORT,
    itemNoun: { singular: "movement", plural: "movements" },
    onSelectionChange: (_keys, rows) => {
      selectedMovements = rows;
    },
    // A row's own gesture opens it everywhere else in the product; here there is nothing to open,
    // so activating a row shows its details in the panel rather than doing nothing at all.
    onActivate: () => {
      panelPreference.set("open");
    },
  });

  const stripFigures = $derived(
    footerFigures(ledger, grid.isFiltered ? grid.rowsInView : movements, {
      filtered: grid.isFiltered,
      money,
      unservedReason: unservedPositionTitle,
    }),
  );

  // ---- the account, and what every act on this surface waits on ---------------------------------

  const orderedAccounts = $derived(trustAccountsInPickingOrder(accounts));
  const accountChoices = $derived<readonly ChoiceOption[]>(
    orderedAccounts.map((one) => ({
      value: one.id,
      label: one.name,
      aside: trustAccountLabel(one),
      keywords: [one.bankName ?? "", one.accountNumberLastFour ?? ""],
    })),
  );
  /*
   * The picker stands where there is a choice to make. That is more than one account — and also the
   * case where the roster's only account is closed, which is never chosen for anybody: without the
   * control its history would be unreachable.
   */
  const picksAccount = $derived(accounts.length > 1 || (accounts.length === 1 && account === null));

  const noAccountRefusal = $derived.by((): string | undefined => {
    if (accounts.length === 0) {
      return "The firm has not opened a trust account yet, so there is nowhere to hold client money.";
    }
    if (account === null) return "No trust account is chosen, so there is nothing to act against.";
    return undefined;
  });

  const manageRefusal = $derived.by((): string | undefined => {
    if (permissions === null) return "Reading your session.";
    if (permissions.includes(TRUST_PERMISSIONS.manage)) return undefined;
    return permissionRefusal("Moving client money", TRUST_PERMISSIONS.manage);
  });

  const availableMinor = $derived(ledger?.availableMinor ?? 0);

  function actRefusal(nothingToMove: string): string | undefined {
    const refused = manageRefusal ?? noAccountRefusal;
    if (refused !== undefined) return refused;
    if (ledger === null) return nothingToMove;
    if (availableMinor <= 0) {
      return "This matter's trust ledger has nothing available, so there is nothing to move.";
    }
    return undefined;
  }

  const payOutRefusal = $derived(
    actRefusal(
      "Nothing has been paid into this matter's trust ledger yet, so there is nothing to pay out.",
    ),
  );
  const transferRefusal = $derived(
    actRefusal(
      "Nothing has been paid into this matter's trust ledger yet, so there is nothing to transfer.",
    ),
  );

  // ---- the panels that write --------------------------------------------------------------------

  let depositOpen = $state(false);
  let disbursementOpen = $state(false);
  let transferOpen = $state(false);
  let approveOpen = $state(false);
  let rejectOpen = $state(false);
  let withdrawOpen = $state(false);
  let answeringRequest = $state<TrustPendingRequest | null>(null);
  let answerKey = $state("");
  /** What a proposal that did not release came to, until the section is read again. */
  let proposalNotice = $state<string | null>(null);

  /*
   * The one create action this surface has, exported for the section page: the matter header's
   * create control is the only button that records a deposit here (create-action.svelte.ts), so
   * the ledger keeps no button of its own and answers the header's press.
   */
  export function openNew(): void {
    depositOpen = true;
  }

  /**
   * The key one answer to one request is sent under, kept per request.
   *
   * It is minted on the gesture that starts the answer and reused while that answer is still being
   * attempted, so a reader who presses through a refusal is retrying one decision rather than
   * filing a second one. It is dropped once the decision lands.
   */
  const answerKeys = new Map<string, string>();
  function keyForAnswer(requestId: string): string {
    const existing = answerKeys.get(requestId);
    if (existing !== undefined) return existing;
    const minted = crypto.randomUUID();
    answerKeys.set(requestId, minted);
    return minted;
  }

  /** A verb was pressed on a waiting request: the panel that asks for it opens. */
  function decide(verb: TrustRequestVerb, request: TrustPendingRequest): void {
    answeringRequest = request;
    answerKey = keyForAnswer(request.id);
    approveOpen = verb === "approve";
    rejectOpen = verb === "reject";
    withdrawOpen = verb === "withdraw";
  }

  function answered(requestId: string): void {
    answerKeys.delete(requestId);
    proposalNotice = null;
    onChanged();
  }

  function proposed(acknowledgement: TrustDisbursementProposalAck): void {
    proposalNotice =
      acknowledgement.status === "pending"
        ? proposalPendingSentence(acknowledgement.eligibleApprovers)
        : null;
    onChanged();
  }

  /** Who proposed a pending request, as a name where the firm's roster can say. */
  function requestedByName(request: TrustPendingRequest): string {
    return memberDisplay(request.requestedBy, firmRoster.members).text;
  }

  // ---- what the notices band has to say ----------------------------------------------------------

  const noLedgerSentence = $derived(
    account === null
      ? null
      : noLedgerYet
        ? `This matter holds no trust ledger in ${account.name} yet. Its ledger is created by the first deposit.`
        : null,
  );

  const hasNotice = $derived(
    accounts.length === 0 ||
      noLedgerSentence !== null ||
      accountsCapped ||
      pendingRequests.length > 0 ||
      pendingRefusal !== null ||
      proposalNotice !== null,
  );

  // ---- the menu ------------------------------------------------------------------------------

  /*
   * What the menu speaks for. Right-clicking inside the selection speaks for all of it; right-
   * clicking outside re-targets that one row first, so the scope comes from the selection.
   *
   * COPY IS THE WHOLE MENU. A movement takes no verb, so the menu offers only the values worth
   * putting on the clipboard, and is absent rather than empty over nothing.
   */
  let contextTarget = $state<TrustMovementRecord | null>(null);
  const menuScope = $derived(
    selectedMovements.length > 0
      ? selectedMovements
      : contextTarget === null
        ? []
        : [contextTarget],
  );

  const menu = $derived.by((): RecordMenuModel => {
    const target = menuScope[0];
    if (target === undefined) return [];
    const choices: RecordMenuChoice[] = [];
    if (target.reference !== null) {
      choices.push({ identifier: "reference", label: `Reference: ${target.reference}` });
    }
    choices.push({ identifier: "purpose", label: "Purpose" });
    choices.push({ identifier: "amount", label: `Amount: ${money(target.amountMinor)}` });
    return menuOf([
      {
        identifier: "record",
        items: [
          {
            kind: "flyout",
            identifier: "copyValue",
            label: "Copy",
            icon: Copy,
            choices,
            ...oneRecordGesture(menuScope.length, "Copying a value works on one record at a time."),
          },
        ],
      },
    ]);
  });

  /** Re-target the selection to the row under the pointer, without swallowing the menu's own event. */
  function retargetSelection(event: MouseEvent): void {
    const element = event.target instanceof Element ? event.target.closest("[data-grid-row]") : null;
    const key = element?.getAttribute("data-grid-row") ?? null;
    if (key === null) return;
    contextTarget = movements.find((movement) => movement.id === key) ?? null;
    if (!grid.isSelected(key)) grid.rowClick(key, { repeated: true });
  }

  function copyMenuValue(identifier: string): void {
    const movement = menuScope[0];
    if (movement === undefined) return;
    const text =
      identifier === "reference"
        ? (movement.reference ?? "")
        : identifier === "purpose"
          ? movement.purpose
          : money(movement.amountMinor);
    if (text !== "") void navigator.clipboard.writeText(text);
  }

  const caption = $derived(
    matterNumber === null
      ? `Trust movements on ${matterTitle}`
      : `Trust movements on ${matterNumber}, ${matterTitle}`,
  );

</script>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<TrustMovementRecord>)}
  {#if column.id === TRUST_COLUMN_IDENTIFIERS.effectiveDate}
    <span class="whitespace-nowrap tabular-nums">{formatDate(row.effectiveDate)}</span>
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.kind}
    <span title={kindSentence(row.kind)}>{kindLabel(row.kind)}</span>
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.reference}
    {#if row.reference === null}
      <span class="text-text-subtle" title="This movement carries no check or confirmation number.">
        &mdash;
      </span>
    {:else}
      <span class="block truncate tabular-nums" title={row.reference}>{row.reference}</span>
    {/if}
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.counterparty}
    {@const counterparty = counterpartyText(row, ownNode)}
    <span class="block truncate" title={counterparty}>{counterparty}</span>
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.purpose}
    <span class="block truncate" title={row.purpose}>{row.purpose}</span>
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.amountIn || column.id === TRUST_COLUMN_IDENTIFIERS.amountOut}
    {#if text === ""}
      <span class="text-text-subtle" title={NO_AMOUNT_ON_THIS_SIDE}>&mdash;</span>
    {:else}
      <span class="whitespace-nowrap tabular-nums">{text}</span>
    {/if}
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.recordedBy}
    {@const recorder = memberDisplay(row.recordedBy, firmRoster.members)}
    <span class="block truncate" title={recorder.title}>{recorder.text}</span>
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.authorizedBy}
    {#if row.authorizedBy === null}
      <span class="text-text-muted" title={authorizedByTitle(row)}>{authorizedByText(row)}</span>
    {:else}
      {@const authorizer = memberDisplay(row.authorizedBy, firmRoster.members)}
      <span class="block truncate" title={authorizer.title ?? authorizedByTitle(row)}>
        {authorizer.text}
      </span>
    {/if}
  {:else if column.id === TRUST_COLUMN_IDENTIFIERS.recordedAt}
    <span class="whitespace-nowrap tabular-nums">{formatInstant(row.recordedAt)}</span>
  {:else}
    {text}
  {/if}
{/snippet}

<!-- The account this surface reads against, then the two acts that move money out of it. Each act
     is disabled carrying its reason rather than removed: the reader learns the act exists and what
     it is waiting for. -->
{#snippet acts()}
  {#if picksAccount}
    <!-- A width off the generated scale compiles to nothing at all, so the field takes a container
         width: wide enough for an account's name, narrow enough to leave the row its navigation. -->
    <div class="w-2xs">
      <ChoicePicker
        label="Trust Account"
        options={accountChoices}
        value={account?.id ?? ""}
        onchange={(chosen) => onChooseAccount(chosen)}
      />
    </div>
  {:else if account !== null}
    <span class="whitespace-nowrap text-xs text-text-muted" title={trustAccountLabel(account)}>
      {account.name}
    </span>
  {/if}

  <Button
    variant="secondary"
    size="sm"
    disabled={payOutRefusal !== undefined}
    title={payOutRefusal ?? "Pay client money out of this matter's trust ledger."}
    onclick={() => (disbursementOpen = true)}
  >
    <ArrowUpFromLine class="size-16" aria-hidden="true" />
    Pay Out
  </Button>
  <Button
    variant="secondary"
    size="sm"
    disabled={transferRefusal !== undefined}
    title={transferRefusal ?? "Move this money to another matter of the same client."}
    onclick={() => (transferOpen = true)}
  >
    <ArrowLeftRight class="size-16" aria-hidden="true" />
    Transfer
  </Button>
{/snippet}

{#snippet notices()}
  {#if accounts.length === 0}
    <Alert.Root variant="info">
      <Alert.Title>The firm has not opened a trust account yet.</Alert.Title>
    </Alert.Root>
  {/if}

  {#if noLedgerSentence !== null}
    <p class="text-xs text-text-muted">{noLedgerSentence}</p>
  {/if}

  {#if accountsCapped}
    <Alert.Root variant="warning">
      <Alert.Description>{ROSTER_CAPPED_WARNING}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if proposalNotice !== null}
    <p class="text-xs text-text-muted">{proposalNotice}</p>
  {/if}

  {#if pendingRefusal !== null}
    <p class="text-xs text-status-warning-subtle-foreground">{pendingRefusal}</p>
  {/if}

  <!-- One request reads the same here and on the firm's Trust screen, down to the verbs it offers
       and the panel each of them opens. The matter already knows which matter it is, so the Matter
       row stands only on the firm's side. -->
  {#each pendingRequests as request (request.id)}
    <PendingRequest
      {request}
      viewer={{ sessionUserId, permissions }}
      members={firmRoster.members}
      {money}
      onDecide={decide}
    />
  {/each}
{/snippet}

{#snippet list({ density, tableClass, frame }: { density: MoneySurfaceDensity; tableClass: string; frame: "card" | "flush" })}
  <RecordMenu
    class="flex min-h-0 flex-1 flex-col"
    {menu}
    onAction={() => undefined}
    onChoice={(_flyout, choice) => copyMenuValue(choice.identifier)}
  >
    <!-- The re-target runs on the way up and does NOT swallow the event, so the menu the product
         uses everywhere is still the thing that opens. -->
    <div class="flex min-h-0 flex-1 flex-col" role="presentation" oncontextmenu={retargetSelection}>
      <DataTable.Grid
        {grid}
        {cell}
        {frame}
        class={tableClass}
        {density}
        {caption}
        {loading}
      />
    </div>
  </RecordMenu>
{/snippet}

{#snippet panel()}
  <TrustDetailsPanel
    {ledger}
    {movements}
    selected={selectedMovements}
    {money}
    {unservedPositionTitle}
    onLetGo={() => grid.clearSelection()}
  />
{/snippet}

<!-- The shared strip every money ledger states its figures through. The position carries the whole
     record's scope, so a filter never labels it "In view:"; the net of the rows a filter leaves
     does narrow, and the strip says so in front of it. -->
{#snippet figures()}
  <DataTable.GridFigures {grid} figures={stripFigures} />
{/snippet}

<MoneySurface
  {matterId}
  section="trust"
  {grid}
  autoSaveId="matter-trust-panes"
  {panelOpen}
  onTogglePanel={(open) => panelPreference.set(open ? "open" : "closed")}
  notices={hasNotice ? notices : undefined}
  {acts}
  {list}
  {panel}
  {figures}
/>

<DepositDialog
  bind:open={depositOpen}
  {account}
  {matterId}
  {matterNumber}
  onRecorded={() => {
    proposalNotice = null;
    onChanged();
  }}
/>

<DisbursementDialog
  bind:open={disbursementOpen}
  {account}
  {matterId}
  {matterNumber}
  {availableMinor}
  {money}
  onProposed={proposed}
/>

<MatterTransferDialog
  bind:open={transferOpen}
  {account}
  {matterId}
  {matterNumber}
  {availableMinor}
  {money}
  onTransferred={() => {
    proposalNotice = null;
    onChanged();
  }}
/>

<ApproveRequestDialog
  bind:open={approveOpen}
  request={answeringRequest}
  {matterNumber}
  {money}
  requestedByName={answeringRequest === null ? "" : requestedByName(answeringRequest)}
  submissionKey={answerKey}
  onApproved={() => answered(answeringRequest?.id ?? "")}
/>

<RejectRequestDialog
  bind:open={rejectOpen}
  request={answeringRequest}
  {matterNumber}
  {money}
  submissionKey={answerKey}
  onRejected={() => answered(answeringRequest?.id ?? "")}
/>

<WithdrawRequestDialog
  bind:open={withdrawOpen}
  request={answeringRequest}
  {money}
  submissionKey={answerKey}
  onWithdrawn={() => answered(answeringRequest?.id ?? "")}
/>
