<script lang="ts">
  /*
   * TRUST — every trust account the firm holds, and the work that sits on one.
   *
   * THE REGISTER IS THE SCREEN. A firm's trust accounts are the record this destination exists to
   * answer for: which accounts, at which banks, held by which office, under which state's rules, and
   * which of them are still open. Opening one is the create act over that record rather than a form
   * the screen opens on, which is the same arrangement every other list screen in the product uses.
   *
   * THE WORK SITS BESIDE THE LIST, NOT UNDER IT. What is waiting on approval, what the bank last
   * reported, what has been reconciled, what the firm's own cushion holds: all of it belongs to ONE
   * account, and a reader moving between accounts is comparing those things. So the list keeps the
   * left, the panel takes the right, and the panel follows whatever is selected — the two-sided
   * arrangement the money surfaces already use, down to the toggle at the end of the counts strip.
   *
   * THE SEARCH IS THE BROWSER'S, HONESTLY. The roster read walks the listing to its end, so what is
   * in hand IS the whole record and narrowing it answers the question a reader asked. Where the walk
   * stopped short the roster says so and the screen says so above the table, because a search that
   * quietly speaks for a fraction of a firm's trust accounts is worse than no search at all.
   *
   * THE ACCOUNT RIDES THE ADDRESS, so a partner who wants a colleague to look at one account's
   * queue sends the link rather than the instruction to go find it.
   *
   * WHAT A READER MAY DO IS DECIDED HERE, ONCE, AND HANDED DOWN. Three capabilities govern this
   * screen's acts — managing accounts and statements, acting on the firm's own cushion, and
   * changing the authorization posture — and each is read off the session in one place, as the
   * sentence a refused control carries. A section that worked out its own refusal would be a
   * second answer to the same question, and the two would drift.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import * as DetailsPanel from "$lib/details-panel/index.ts";
  import { LedgerPanes } from "$lib/records/index.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { firmOffices } from "$lib/offices/index.ts";
  import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
  import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
  import {
    TRUST_PERMISSIONS,
    type TrustAccountListing,
    type TrustPendingRequest,
  } from "$lib/trust/trust-api.ts";
  import { memberDisplay } from "$lib/trust/trust-member-names.ts";
  import { ROSTER_CAPPED_WARNING } from "$lib/trust/trust-vocabulary.ts";
  import ApproveRequestDialog from "$lib/trust/approve-request-dialog.svelte";
  import RejectRequestDialog from "$lib/trust/reject-request-dialog.svelte";
  import FirmOpenAccountDialog from "$lib/trust/firm-open-account-dialog.svelte";
  import WithdrawRequestDialog from "$lib/trust/withdraw-request-dialog.svelte";
  import FirmTrustPanel from "$lib/trust/firm-trust-panel.svelte";
  import FirmTrustPostureDialog from "$lib/trust/firm-trust-posture-dialog.svelte";
  import { FirmTrust } from "$lib/trust/firm-trust.svelte.ts";
  import {
    FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS,
    FIRM_TRUST_ACCOUNT_INITIAL_SORT,
    firmTrustAccountColumns,
  } from "$lib/trust/firm-trust-columns.ts";
  import { accountsMatching, type TrustRequestVerb } from "$lib/trust/firm-trust-model.ts";
  import {
    IOLTA_MEANING,
    JURISDICTION_NOT_RECORDED,
    JURISDICTION_NOT_RECORDED_MEANING,
    accountStandingLabel,
    accountStandingMeaning,
    accountStandingTone,
    trustMoneyText,
  } from "$lib/trust/firm-trust-vocabulary.ts";

  // ---- who is asking, and what the firm holds ---------------------------------------------------

  let sessionUserId = $state<string | null>(null);
  let permissions = $state<readonly string[] | null>(null);
  let bootstrapped = false;

  const trust = new FirmTrust();

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") {
        sessionUserId = outcome.value.user.id;
        permissions = outcome.value.permissions;
      }
    })();
    void trust.loadAccounts(fetch);
    void trust.loadPolicy(fetch);
    // The offices name the accounts' holding office and fill the opening dialog's picker; the
    // roster turns the user identifiers on the queue into names. Neither is the screen's subject,
    // so the register never waits on either.
    void firmOffices.load(fetch);
    void firmRoster.load(fetch);
  });

  const accounts = $derived(trust.accounts ?? []);
  const officeName = (locationId: string): string | null =>
    firmOffices.byId(locationId)?.name ?? null;

  // ---- the table ---------------------------------------------------------------------------------

  let searchText = $state("");
  let appliedSearch = $state("");

  const rows = $derived(accountsMatching(accounts, appliedSearch));

  const grid = DataTable.createDataTableGrid<TrustAccountListing>({
    columns: () =>
      firmTrustAccountColumns({
        officeName,
        officeNames: (firmOffices.offices ?? []).map((office) => office.name),
      }),
    rows: () => rows,
    rowKey: (account) => account.id,
    initialSort: FIRM_TRUST_ACCOUNT_INITIAL_SORT,
    itemNoun: { singular: "account", plural: "accounts" },
    // The panel follows the selection: one account selected is one account's work on the right,
    // and none or several is the face that speaks for the firm's roster.
    onSelectionChange: (_keys, selected) => {
      selectedAccountId = selected.length === 1 ? (selected[0]?.id ?? null) : null;
    },
    onActivate: (account) => {
      selectAccount(account.id);
      panelPreference.set("open");
    },
  });

  const narrowed = $derived(appliedSearch.trim() !== "" || grid.activeFilterCount > 0);
  const narrowingSummary = $derived(
    appliedSearch.trim() === ""
      ? "Show every account"
      : `Showing "${appliedSearch.trim()}" of the roster`,
  );

  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
    grid.clearAllFilters();
  }

  // ---- the selected account ----------------------------------------------------------------------

  let selectedAccountId = $state<string | null>(null);
  const selectedAccount = $derived(trust.accountFor(selectedAccountId));

  /*
   * The currency the register is written in, read off the accounts rather than assumed. Every trust
   * account is opened in United States dollars on today's contract, and reading it off the records
   * is what keeps the panel's figures right when that stops being true.
   */
  const currency = $derived(selectedAccount?.currency ?? accounts[0]?.currency ?? "USD");
  const money = (amountMinor: number): string => trustMoneyText(amountMinor, currency);

  /**
   * Select an account and make the table agree, so the row a reader is reading is the marked one.
   *
   * The table's selection is written directly rather than through a gesture: this is the SCREEN
   * naming a selection (from the address, from a firm with one account, from an account just
   * opened) rather than reacting to one, and going back through the grid's own click handling
   * would re-enter the change handler that set this in the first place.
   */
  function selectAccount(trustAccountId: string | null): void {
    selectedAccountId = trustAccountId;
    grid.selection =
      trustAccountId === null
        ? { keys: [], anchor: null, focus: null }
        : { keys: [trustAccountId], anchor: trustAccountId, focus: trustAccountId };
  }

  /*
   * An account named in the address opens on it, once the roster carries it; a firm with exactly
   * one account opens on that one, because a panel beside a single-row table with nothing selected
   * is a question with one possible answer. Both happen once: a reader who then lets go of the
   * account is not re-selected by the same address on the next read.
   */
  let seededFromAddress = false;
  $effect(() => {
    if (seededFromAddress || trust.accounts === null) return;
    const named = page.url.searchParams.get("account");
    const only = accounts.length === 1 ? (accounts[0]?.id ?? null) : null;
    const opening = named !== null && trust.accountFor(named) !== null ? named : only;
    seededFromAddress = true;
    if (opening !== null) selectAccount(opening);
  });

  /*
   * The selected account rides the address, so the view is a link somebody can send. `replaceState`
   * rather than a navigation: selecting an account is the same screen looking at one of its rows,
   * and stacking every selection on the history would make Back useless.
   */
  $effect(() => {
    if (!seededFromAddress) return;
    const url = new URL(page.url);
    if (selectedAccountId === null) url.searchParams.delete("account");
    else url.searchParams.set("account", selectedAccountId);
    if (url.href !== page.url.href) replaceState(url, page.state);
  });

  /** The panel's four reads follow the selection, and a superseded one writes nothing. */
  $effect(() => {
    trust.selectAccount(fetch, selectedAccountId);
  });

  /* The panel's open state is the reader's, and it survives leaving the tab and coming back. */
  const panelPreference = createPersistedPreference(
    stringUnionPreference("magna-carta-firm-trust-panel", ["open", "closed"] as const, "open"),
  );
  const panelOpen = $derived(panelPreference.current === "open");

  // ---- opening an account --------------------------------------------------------------------------

  let openAccountOpen = $state(false);

  const createRefusal = $derived.by((): string | undefined => {
    if (permissions === null) return "Reading your session.";
    if (!permissions.includes(TRUST_PERMISSIONS.manage)) {
      return permissionRefusal("Opening a trust account", TRUST_PERMISSIONS.manage);
    }
    if (firmOffices.offices === null) return "Reading the firm's offices.";
    if (firmOffices.active.length === 0) {
      return (
        "The firm has no office to bind the account to. A trust account sits in the state of the " +
        "office that holds it, so add one on Offices under Settings first."
      );
    }
    return undefined;
  });

  function accountOpened(account: TrustAccountListing): void {
    void (async () => {
      await trust.loadAccounts(fetch);
      selectAccount(account.id);
      panelPreference.set("open");
    })();
  }

  // ---- deciding a request ---------------------------------------------------------------------------

  let decidingRequest = $state<TrustPendingRequest | null>(null);
  let approveOpen = $state(false);
  let rejectOpen = $state(false);
  let withdrawOpen = $state(false);

  /*
   * The answer this reader is giving, minted on the gesture that opened the panel and reused on
   * every retry of it. A fresh key per press would let a retried approval post the movement twice,
   * which is a second real payment out of a client's money.
   */
  let submissionKey = $state("");

  function decide(verb: TrustRequestVerb, request: TrustPendingRequest): void {
    decidingRequest = request;
    submissionKey = crypto.randomUUID();
    approveOpen = verb === "approve";
    rejectOpen = verb === "reject";
    withdrawOpen = verb === "withdraw";
  }

  /**
   * After any decision the queue is read again: what is waiting is the server's answer, not ours.
   *
   * The position goes with it, because an approval posts a movement — the book balance, the client
   * ledgers and the count of what is waiting all move on the same gesture, and a panel where one
   * figure changed and the others did not is a panel that disagrees with itself.
   */
  function decided(): void {
    decidingRequest = null;
    if (selectedAccountId === null) return;
    trust.reloadQueue(fetch, selectedAccountId);
    trust.reloadPosition(fetch, selectedAccountId);
  }

  // ---- the firm's posture ---------------------------------------------------------------------------

  let postureOpen = $state(false);

  const postureRefusal = $derived.by((): string | undefined => {
    if (permissions === null) return "Reading your session.";
    if (!permissions.includes(TRUST_PERMISSIONS.authorize)) {
      return permissionRefusal("Changing the firm's authorization posture", TRUST_PERMISSIONS.authorize);
    }
    return undefined;
  });

  // ---- what else this reader may do ----------------------------------------------------------------

  /**
   * Recording and importing a statement, opening a reconciliation over one, and every act on a
   * diligence file over a quiet client ledger.
   *
   * ONE CAPABILITY, SO ONE SENTENCE. The acts differ and the permission does not, and a section
   * that worked out its own wording would leave one control on this panel saying something
   * different from the five beside it about the same account.
   */
  const manageRefusal = $derived.by((): string | undefined => {
    if (permissions === null) return "Reading your session.";
    if (!permissions.includes(TRUST_PERMISSIONS.manage)) {
      return permissionRefusal(
        "Recording a statement, a reconciliation or a diligence file",
        TRUST_PERMISSIONS.manage,
      );
    }
    return undefined;
  });

  /** Opening the bank-charge cushion, funding it, and recording a charge against it. */
  const firmFundsRefusal = $derived.by((): string | undefined => {
    if (permissions === null) return "Reading your session.";
    if (!permissions.includes(TRUST_PERMISSIONS.firmFunds)) {
      return permissionRefusal("Acting on the bank-charge cushion", TRUST_PERMISSIONS.firmFunds);
    }
    return undefined;
  });

  // ---- what a refused read means ---------------------------------------------------------------------

  const readRefusal = $derived.by((): string | null => {
    if (trust.accountsFailure?.problem?.status !== 403) return null;
    return permissionRefusal("Reading the firm's trust accounts", TRUST_PERMISSIONS.read);
  });
</script>

<svelte:head><title>Trust · Magna Carta</title></svelte:head>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<TrustAccountListing>)}
  {#if column.id === FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.standing}
    <Badge variant={accountStandingTone(row.status)} title={accountStandingMeaning(row.status)}>
      {accountStandingLabel(row.status)}
    </Badge>
  {:else if column.id === FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.accountNumberLastFour}
    <span class="tabular-nums">{text}</span>
  {:else if column.id === FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.jurisdiction}
    {#if row.jurisdiction === null}
      <span class="text-text-subtle" title={JURISDICTION_NOT_RECORDED_MEANING}>
        {JURISDICTION_NOT_RECORDED}
      </span>
    {:else}
      {text}
    {/if}
  {:else if column.id === FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.office}
    {#if officeName(row.locationId) === null}
      <!-- The office roster does not hold this identifier, so the identifier stands rather than the
           cell reading as an account bound to nothing. -->
      <span
        class="text-text-subtle"
        title="This office is not on the firm's office list as read, so the identifier the account carries is shown."
      >
        {row.locationId}
      </span>
    {:else}
      <span class="block truncate" title={text}>{text}</span>
    {/if}
  {:else if column.id === FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.iolta}
    <span title={IOLTA_MEANING}>{text}</span>
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet listColumn()}
  <div class="flex min-h-0 flex-1 flex-col gap-12">
    {#if trust.capped}
      <!-- The walk stopped short of the end, so the search below narrows SOME of the firm's
           accounts rather than all of them, and says so rather than answering quietly. -->
      <Alert.Root variant="warning">
        <Alert.Description>{ROSTER_CAPPED_WARNING}</Alert.Description>
      </Alert.Root>
    {/if}

    <DataTable.Grid
      {grid}
      {cell}
      class="min-h-0 flex-1"
      caption="The firm's trust accounts"
      loading={trust.accounts === null}
    />

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <DetailsPanel.Toggle
          open={panelOpen}
          onToggle={(next) => panelPreference.set(next ? "open" : "closed")}
        />
      {/snippet}
    </DataTable.GridFooter>
  </div>
{/snippet}

{#snippet panel()}
  <FirmTrustPanel
    account={selectedAccount}
    {accounts}
    {trust}
    viewer={{ sessionUserId, permissions }}
    members={firmRoster.members}
    {officeName}
    {money}
    {currency}
    {manageRefusal}
    {firmFundsRefusal}
    {postureRefusal}
    onLetGo={() => selectAccount(null)}
    onDecide={decide}
    onChangePosture={() => (postureOpen = true)}
  />
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader title="Trust">
    {#snippet actions()}
      <!-- The search, then the create control, then the way back to everything: the same row, in
           the same order, as every other list screen. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search the firm's trust accounts"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />

      <CreateControl
        noun="Account"
        title="Open a trust account, bound to the office that holds it."
        refusal={createRefusal}
        onpress={() => (openAccountOpen = true)}
      />

      <DataTable.ClearFilters
        {grid}
        narrowing={{ narrowed, summary: narrowingSummary, clear: clearNarrowing }}
      />
    {/snippet}
  </ScreenHeader>

  {#if trust.accountsFailure !== null}
    {#if readRefusal !== null}
      <Alert.Root variant="danger">
        <Alert.Title>The Firm's Trust Accounts Are Not Yours To Read</Alert.Title>
        <Alert.Description>{readRefusal}</Alert.Description>
      </Alert.Root>
    {:else}
      <FailureNotice
        failure={trust.accountsFailure}
        title="The Trust Accounts Could Not Be Read"
        fallback="The record itself is unaffected: nothing was changed by this failure, and every account the firm holds is still on its record."
        onRetry={() => void trust.loadAccounts(fetch)}
      />
    {/if}
  {:else}
    <LedgerPanes autoSaveId="firm-trust-panes" {panelOpen} list={listColumn} {panel} />
  {/if}
</div>

<FirmOpenAccountDialog bind:open={openAccountOpen} onOpened={accountOpened} />

<!-- The queue serves the matter behind each request, so the panel deciding it names that matter by
     the number somebody would read back down a telephone rather than showing none. -->
<ApproveRequestDialog
  bind:open={approveOpen}
  request={decidingRequest}
  matterNumber={decidingRequest?.matterNumber ?? null}
  {money}
  requestedByName={decidingRequest === null
    ? ""
    : memberDisplay(decidingRequest.requestedBy, firmRoster.members).text}
  {submissionKey}
  onApproved={decided}
/>

<RejectRequestDialog
  bind:open={rejectOpen}
  request={decidingRequest}
  matterNumber={decidingRequest?.matterNumber ?? null}
  {money}
  {submissionKey}
  onRejected={decided}
/>

<WithdrawRequestDialog
  bind:open={withdrawOpen}
  request={decidingRequest}
  {money}
  {submissionKey}
  onWithdrawn={decided}
/>

<FirmTrustPostureDialog
  bind:open={postureOpen}
  current={trust.policy?.current ?? null}
  {currency}
  onChanged={() => void trust.loadPolicy(fetch)}
/>
