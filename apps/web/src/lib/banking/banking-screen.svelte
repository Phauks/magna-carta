<script lang="ts">
  /*
   * BANKING — what the bank says, beside the books. The bank accounts down the left, grouped by
   * the kind of account they are in the books, each with the bank's balance and the books'; the
   * selected account's bank lines on the right, each marked In Books or Not in Books. Nothing here
   * posts to the books: Add to Books shows the line and sends it to where the books take an entry.
   *
   * Connecting a bank opens the bank's own sign-in window (the provider's, not ours), then asks
   * which account in the books each bank account is. Signing in again and disconnecting live in
   * each bank's menu under the cards.
   *
   * The screen reads through the service it is handed, so the developer-console gallery renders
   * this screen over fixtures rather than a second copy of it.
   */
  import { untrack } from "svelte";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { SAMPLE_AMOUNTS, SAMPLE_ORGANIZATIONS } from "@magna-carta/design-system/loading-fixtures";
  import { toast } from "@magna-carta/design-system/toast";
  import LinkIcon from "@lucide/svelte/icons/link";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type {
    BankConnection,
    BankFeedAccount,
    BankFeedTransaction,
    BankFeedTransactionsResponse,
    BankingOverviewResponse,
  } from "./banking-api.ts";
  import type { BankingService } from "./banking-service.ts";
  import { LINE_COLUMNS, lineColumns } from "./banking-columns.ts";
  import {
    accountBalanceText,
    accountBankLine,
    accountBooksLine,
    accountTitle,
    cardBadge,
    filterLines,
    groupAccounts,
    lineCounts,
    readTime,
    selectedAccountId,
    statusLabel,
    statusTone,
    windowLine,
    type BankingOpening,
    type LineFilter,
    type ReadingOptions,
  } from "./banking-model.ts";
  import BankingAccountCard from "./banking-account-card.svelte";
  import BankingConnections from "./banking-connections.svelte";
  import BankingConnectDialog from "./banking-connect-dialog.svelte";
  import BankingDisconnectDialog from "./banking-disconnect-dialog.svelte";
  import BankingAddToBooksDialog from "./banking-add-to-books-dialog.svelte";

  let {
    service,
    manageRefusal,
    initialAccountId = null,
    onSelectAccount,
    now = () => new Date(),
    timeZone,
    opening,
  }: {
    service: BankingService;
    /** Why this reader may not connect, tie or disconnect, or undefined where they may. */
    manageRefusal: string | undefined;
    /** The account the address names, if it names one. */
    initialAccountId?: string | null;
    onSelectAccount?: (accountId: string) => void;
    now?: () => Date;
    /** The zone read times are shown in. The viewer's own, unless a gallery pins one. */
    timeZone?: string;
    opening?: BankingOpening;
  } = $props();

  // ---- the overview -----------------------------------------------------------------------------

  let overview = $state<BankingOverviewResponse | null>(null);
  let overviewFailure = $state<StatedFailure | null>(null);
  let reading = $state(false);

  async function loadOverview(): Promise<void> {
    reading = true;
    const outcome = await service.readOverview();
    reading = false;
    if (outcome.kind === "ok") {
      overviewFailure = null;
      overview = outcome.value;
      return;
    }
    // A failed re-read keeps what is on screen; only a first read that fails says so.
    if (overview === null) overviewFailure = stated(outcome.failure, "Nothing was changed.");
    else toast.error("Couldn't read the banks again. What is shown may be out of date.");
  }

  const accounts = $derived(overview?.accounts ?? []);
  const groups = $derived(groupAccounts(accounts));
  const connections = $derived(overview?.connections ?? []);
  const connectionOf = (account: BankFeedAccount): BankConnection | null =>
    connections.find((connection) => connection.id === account.connectionId) ?? null;
  const readingOptions = $derived<ReadingOptions>({ now: now(), timeZone });

  let requestedAccountId = $state<string | null>(untrack(() => initialAccountId));
  const selectedId = $derived(selectedAccountId(accounts, requestedAccountId));
  const selected = $derived(accounts.find((account) => account.id === selectedId) ?? null);

  function select(accountId: string): void {
    requestedAccountId = accountId;
    onSelectAccount?.(accountId);
  }

  // ---- the selected account's lines -------------------------------------------------------------

  let lines = $state<BankFeedTransactionsResponse | null>(null);
  let linesFailure = $state<StatedFailure | null>(null);

  async function loadLines(accountId: string): Promise<void> {
    const outcome = await service.readTransactions(accountId);
    if (selectedId !== accountId) return;
    if (outcome.kind === "ok") {
      linesFailure = null;
      lines = outcome.value;
    } else {
      linesFailure = stated(outcome.failure, "Nothing was changed.");
    }
  }

  $effect(() => {
    const accountId = selectedId;
    untrack(() => {
      lines = null;
      linesFailure = null;
      if (accountId !== null) void loadLines(accountId);
    });
  });

  let filter = $state<LineFilter>("notInBooks");
  const allLines = $derived(lines?.transactions ?? []);
  const counts = $derived(lineCounts(allLines));
  const shownLines = $derived(filterLines(allLines, filter));
  const currency = $derived(selected?.currency ?? "USD");

  const grid = DataTable.createDataTableGrid<BankFeedTransaction>({
    columns: () => lineColumns(currency),
    rows: () => shownLines,
    rowKey: (line) => line.id,
    initialSort: { columnId: LINE_COLUMNS.date, direction: "descending" },
    itemNoun: { singular: "bank transaction", plural: "bank transactions" },
    onActivate: (line) => {
      if (line.status === "notInBooks") openAddToBooks(line);
    },
  });

  // ---- the windows ------------------------------------------------------------------------------

  let addToBooksOpen = $state(false);
  let addToBooksLine = $state<BankFeedTransaction | null>(null);
  function openAddToBooks(line: BankFeedTransaction): void {
    addToBooksLine = line;
    addToBooksOpen = true;
  }

  let connectOpen = $state(false);
  let connectConnectionId = $state<string | null>(null);
  let connectInstitution = $state("");
  const connectAccounts = $derived(
    accounts.filter((account) => account.connectionId === connectConnectionId),
  );
  function openConnectWindow(connectionId: string, institutionName: string | null): void {
    connectConnectionId = connectionId;
    connectInstitution =
      institutionName ??
      connections.find((connection) => connection.id === connectionId)?.institutionName ??
      "Your Bank";
    connectOpen = true;
  }

  let disconnectOpen = $state(false);
  let disconnecting = $state<BankConnection | null>(null);

  // ---- connecting and signing in again ----------------------------------------------------------

  let signingIn = $state(false);
  let actionFailure = $state<StatedFailure | null>(null);
  let actionTitle = $state("");

  /** Open the bank's sign-in window: for a new bank, or again for `connection`. */
  async function signIn(connection: BankConnection | null): Promise<void> {
    signingIn = true;
    actionFailure = null;
    try {
      const token = await service.readSignInToken(connection?.id);
      if (token.kind !== "ok") {
        actionTitle = "Couldn't Open the Bank's Sign-In";
        actionFailure = stated(token.failure, "Nothing was connected.");
        return;
      }
      let result;
      try {
        result = await service.openSignIn(token.value.token);
      } catch {
        toast.error("Couldn't open the bank's sign-in window. Try again.");
        return;
      }
      if (result.kind === "closed") {
        if (result.errorMessage !== null) toast.error(result.errorMessage);
        return;
      }
      if (connection !== null) {
        await loadOverview();
        return;
      }
      const connected = await service.connect(result.success.publicToken, crypto.randomUUID());
      if (connected.kind !== "ok") {
        actionTitle = "Couldn't Connect the Bank";
        actionFailure = stated(
          connected.failure,
          "Nothing was connected.",
          "Couldn't connect. Nothing was connected.",
        );
        return;
      }
      await loadOverview();
      openConnectWindow(connected.value.connectionId, result.success.institutionName);
    } finally {
      signingIn = false;
    }
  }

  // ---- arrival ----------------------------------------------------------------------------------

  let started = false;
  $effect(() => {
    if (started) return;
    started = true;
    void (async () => {
      await loadOverview();
      if (opening?.kind === "connect") openConnectWindow(opening.connectionId, null);
    })();
  });

  let openedLine = false;
  $effect(() => {
    if (openedLine || opening?.kind !== "addToBooks" || lines === null) return;
    const wanted = lines.transactions.find((line) => line.id === opening.transactionId);
    if (wanted === undefined) return;
    openedLine = true;
    untrack(() => openAddToBooks(wanted));
  });

  // ---- the header -------------------------------------------------------------------------------

  const providerConfigured = $derived(overview?.providerConfigured ?? true);
  const connectRefusal = $derived.by((): string | undefined => {
    if (manageRefusal !== undefined) return manageRefusal;
    if (overview === null) return "Reading the banks.";
    if (!providerConfigured) return "Bank feeds aren't set up on this site yet.";
    return undefined;
  });

  const lastRead = $derived.by((): string | null => {
    const times = connections
      .map((connection) => connection.lastSyncedAt)
      .filter((time): time is string => time !== null)
      .toSorted();
    return times.at(-1) ?? null;
  });

  const fixtureAccounts = [0, 1, 2];
</script>

{#snippet card(account: BankFeedAccount)}
  <BankingAccountCard
    title={accountTitle(account)}
    bankName={account.institutionName}
    bankLogo={account.institutionLogo}
    bankLine={accountBankLine(account)}
    balance={accountBalanceText(account)}
    booksLine={accountBooksLine(account)}
    badge={cardBadge(account, connectionOf(account), readingOptions)}
    selected={account.id === selectedId}
    onSelect={() => select(account.id)}
  />
{/snippet}

{#snippet cell({ row, column, text }: DataTable.GridCellContext<BankFeedTransaction>)}
  {#if column.id === LINE_COLUMNS.status}
    <Badge variant={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
  {:else if column.id === LINE_COLUMNS.actions}
    {#if row.status === "notInBooks"}
      <Button
        variant="secondary"
        size="sm"
        disabled={selected?.bookAccount === null}
        title={selected?.bookAccount === null
          ? "Tie this bank account to an account in the books first."
          : undefined}
        onclick={() => openAddToBooks(row)}
      >
        Add to Books
      </Button>
    {/if}
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex flex-col gap-24">
  <ScreenHeader title="Banking">
    {#snippet meta()}
      {#if lastRead !== null}<span>Updated {readTime(lastRead, readingOptions)}</span>{/if}
    {/snippet}
    {#snippet actions()}
      <Button
        variant="primary"
        disabled={connectRefusal !== undefined || signingIn}
        title={connectRefusal}
        onclick={() => void signIn(null)}
      >
        <LinkIcon class="size-16" aria-hidden="true" />
        Connect Bank
      </Button>
    {/snippet}
  </ScreenHeader>

  {#if actionFailure !== null}
    <FailureNotice
      failure={actionFailure.failure}
      title={actionTitle}
      fallback={actionFailure.fallback}
      whenSilent={actionFailure.whenSilent}
      onRetry={() => void signIn(null)}
    />
  {/if}

  {#if overviewFailure !== null}
    <FailureNotice
      failure={overviewFailure.failure}
      title="Couldn't Read the Banks"
      fallback={overviewFailure.fallback}
      onRetry={() => void loadOverview()}
    />
  {:else}
    <div class="flex flex-col gap-24 xl:flex-row xl:items-start">
      <LoadingRegion
        loading={overview === null}
        refreshing={reading}
        empty={accounts.length === 0}
        label="Reading the banks"
        onRetry={() => void loadOverview()}
        class="flex flex-col gap-16 xl:w-sm xl:shrink-0"
      >
        {#snippet emptyState()}
          <EmptyState title="No Banks Connected">
            {#if !providerConfigured}
              <p>Bank feeds aren't set up on this site yet.</p>
            {/if}
          </EmptyState>
        {/snippet}
        {#snippet fixture()}
          <section class="flex flex-col gap-8">
            <h2 class="text-sm font-medium text-text-muted">Operating</h2>
            <div class="grid gap-12 sm:grid-cols-2 xl:grid-cols-1">
              {#each fixtureAccounts as index (index)}
                <BankingAccountCard
                  title={SAMPLE_ORGANIZATIONS[index % SAMPLE_ORGANIZATIONS.length]?.name ?? ""}
                  bankName={SAMPLE_ORGANIZATIONS[(index + 1) % SAMPLE_ORGANIZATIONS.length]?.name ?? ""}
                  bankLogo={null}
                  bankLine={SAMPLE_ORGANIZATIONS[(index + 1) % SAMPLE_ORGANIZATIONS.length]?.name ?? ""}
                  balance={SAMPLE_AMOUNTS[index] ?? ""}
                  booksLine={SAMPLE_AMOUNTS[index + 1] ?? ""}
                  badge={null}
                  selected={false}
                  onSelect={() => {}}
                />
              {/each}
            </div>
          </section>
        {/snippet}
        {#each groups as group (group.kind)}
          <section aria-labelledby={`banking-group-${group.kind}`} class="flex flex-col gap-8">
            <h2 id={`banking-group-${group.kind}`} class="text-sm font-medium text-text-muted">
              {group.label}
            </h2>
            <div class="grid gap-12 sm:grid-cols-2 xl:grid-cols-1">
              {#each group.accounts as account (account.id)}
                {@render card(account)}
              {/each}
            </div>
          </section>
        {/each}
        {#if connections.length > 0}
          <BankingConnections
            {connections}
            {manageRefusal}
            reading={readingOptions}
            onEditAccounts={(connection) => openConnectWindow(connection.id, connection.institutionName)}
            onReconnect={(connection) => void signIn(connection)}
            onDisconnect={(connection) => {
              disconnecting = connection;
              disconnectOpen = true;
            }}
          />
        {/if}
      </LoadingRegion>

      <section aria-labelledby="banking-lines-heading" class="flex min-w-0 flex-1 flex-col gap-12">
        <div class="flex flex-wrap items-center justify-between gap-12">
          <div class="flex min-w-0 flex-wrap items-baseline gap-x-8 gap-y-4">
            <Masthead.Title level={2} id="banking-lines-heading" class="text-xl">
              {selected === null ? "Bank Transactions" : accountTitle(selected)}
            </Masthead.Title>
            {#if lines !== null}
              <span class="text-sm text-text-muted">{windowLine(lines.from, lines.to)}</span>
            {/if}
          </div>
          <span id="banking-filter-label" class="sr-only">Which bank transactions</span>
          <SegmentedControl.Root
            aria-labelledby="banking-filter-label"
            class="w-full sm:w-md"
            value={filter}
            onValueChange={(next) => (filter = next as LineFilter)}
          >
            <SegmentedControl.Item value="notInBooks">Not in Books ({counts.notInBooks})</SegmentedControl.Item>
            <SegmentedControl.Item value="inBooks">In Books ({counts.inBooks})</SegmentedControl.Item>
            <SegmentedControl.Item value="all">All</SegmentedControl.Item>
          </SegmentedControl.Root>
        </div>
        {#if linesFailure !== null}
          <FailureNotice
            failure={linesFailure.failure}
            title="Couldn't Read This Account's Bank Transactions"
            fallback={linesFailure.fallback}
            onRetry={() => {
              if (selectedId !== null) void loadLines(selectedId);
            }}
          />
        {:else}
          <DataTable.Grid
            {grid}
            {cell}
            caption="The bank's transactions on this account"
            loading={overview === null || (selectedId !== null && lines === null)}
            placeholderCount={3}
          />
        {/if}
      </section>
    </div>
  {/if}
</div>

<BankingAddToBooksDialog bind:open={addToBooksOpen} account={selected} line={addToBooksLine} />

<BankingConnectDialog
  bind:open={connectOpen}
  institutionName={connectInstitution}
  accounts={connectAccounts}
  bookAccounts={overview?.bookAccounts ?? []}
  {service}
  {manageRefusal}
  onSaved={() => void loadOverview()}
/>

<BankingDisconnectDialog
  bind:open={disconnectOpen}
  connection={disconnecting}
  {service}
  onDisconnected={() => void loadOverview()}
/>
