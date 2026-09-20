<script lang="ts">
  /*
   * The quiet client ledgers on one trust account, and the diligence the firm records over them.
   *
   * THE READER STATES THE WINDOW, AND THE SECTION NEVER INVENTS ONE. Dormancy is a comparison made
   * at read time against a day somebody chooses: there is no stored flag, no sweep, and no default
   * period. That is not a gap waiting to be filled in — the periods differ by state and by the kind
   * of money, so a field pre-filled with "two years" would be the platform asserting a rule it has
   * no business asserting about a firm's client funds. So the day starts empty, nothing is read
   * until one is chosen, and the list says what it is waiting for.
   *
   * THE CLOCK RUNS FROM RECEIPT, WHICH IS WHY TWO DATES ARE SHOWN. Most rules count from when the
   * money arrived rather than from the last time anything happened on the ledger, so the earliest
   * receipt still on the ledger stands beside the last activity instead of being folded into one
   * "age". The list is ordered by the first of them.
   *
   * NOTHING ON THIS PATH MOVES MONEY. Opening a file records an observation, an attempt records
   * something that already happened, and closing a round attaches a payment that already posted
   * through the ordinary authorized path. Each panel says so where it can be read before its
   * commit.
   *
   * THE STRUCTURE STANDS BEFORE THE DATA DOES, in the same shape the panel's queue uses: a
   * definition list per ledger, and one empty list with its terms standing where there is nothing
   * to show. A reader meets the shape of what is coming rather than a sentence on the canvas.
   *
   * THE READ FAILS ON ITS OWN. A firm whose quiet ledgers cannot be read still has everything else
   * in the panel, so a failure puts one line inside this section and leaves the rest standing.
   */
  import Button from "@magna-carta/design-system/button";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import type { Failure } from "$lib/api/problem.ts";
  import { LatestOnly } from "$lib/api/latest-only.ts";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import { moneySectionHref } from "$lib/money/index.ts";
  import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";
  import {
    TRUST_PERMISSIONS,
    readDormantTrustBalances,
    type TrustDormantBalance,
  } from "./trust-api.ts";
  import { dayText } from "./firm-trust-vocabulary.ts";
  import UnclaimedFundsOpenReviewDialog from "./unclaimed-funds-open-review-dialog.svelte";
  import UnclaimedFundsReviewWindow from "./unclaimed-funds-review-window.svelte";
  import { dormantBalancesInOrder } from "./unclaimed-funds-requests.ts";
  import {
    DORMANT_BALANCES_UNREADABLE,
    NO_DORMANT_BALANCES,
    QUIET_SINCE_LABEL,
    QUIET_SINCE_UNANSWERED,
    REVIEW_STANDING_NONE_MEANING,
    matterDisplay,
    reviewStandingLabel,
  } from "./unclaimed-funds-vocabulary.ts";

  let {
    trustAccountId,
    currency,
    timeZone,
    permissions,
    members,
    money,
  }: {
    /** The account whose client ledgers are being read. */
    trustAccountId: string;
    /** The currency the account is held in, for the one row a served ledger can disagree with. */
    currency: string;
    /** The account's own zone: the day an attempt was made is the firm's day, not the reader's. */
    timeZone: string;
    /** What this account may do, or null while that is still being read. */
    permissions: readonly string[] | null;
    /** The firm's roster, for turning a user identifier into a name. Null while it is being read. */
    members: readonly FirmMemberSummary[] | null;
    money: (amountMinor: number) => string;
  } = $props();

  /** The day the reader states. Deliberately empty: there is no period this section may assume. */
  let quietOnOrBefore = $state("");

  let balances = $state<readonly TrustDormantBalance[] | null>(null);
  let balancesFailure = $state<Failure | null>(null);
  let reading = $state(false);
  const reads = new LatestOnly();

  /*
   * The firm's matters, for turning a ledger's matter identifier into the number and the title a
   * reader knows it by. It is the roster the time surfaces already walk, read once and held: a
   * second read of the same listing would be a second place for "what if it fails" to drift.
   */
  const matters = new FirmMatters();

  /** The ledger a panel is acting on, and the matter it belongs to, once a verb has been pressed. */
  let subjectBalance = $state<TrustDormantBalance | null>(null);
  let openingOpen = $state(false);
  let windowOpen = $state(false);
  let windowReviewId = $state<string | null>(null);

  const rows = $derived(dormantBalancesInOrder(balances ?? []));

  const subjectMatter = $derived(
    subjectBalance === null
      ? undefined
      : matters.byIdentifier(subjectBalance.matterId),
  );
  const subjectMatterNumber = $derived(subjectMatter?.matterNumber ?? null);
  const subjectMatterTitle = $derived(subjectMatter?.title ?? null);

  /**
   * Read the quiet ledgers for one account and one day.
   *
   * It takes both rather than reading what is on screen, so an answer for a day the reader has
   * since changed cannot write itself over the day they are now looking at: the guard drops it
   * exactly as it drops a superseded first read.
   */
  function readBalances(account: string, day: string): void {
    reads.supersede();
    balances = null;
    balancesFailure = null;
    reading = false;
    if (account === "" || day === "") return;
    const attempt = reads.attempt();
    reading = true;
    void (async () => {
      const outcome = await readDormantTrustBalances(fetch, account, day);
      if (!attempt.current) return;
      reading = false;
      if (outcome.kind === "ok") {
        balances = outcome.value.balances;
        balancesFailure = null;
        return;
      }
      balances = null;
      balancesFailure = outcome.failure;
    })();
  }

  $effect(() => {
    readBalances(trustAccountId, quietOnOrBefore);
  });

  $effect(() => {
    void matters.load(fetch);
  });

  /** Whether this account holds the capability the three acts need, and what to say while it does not. */
  const mayManage = $derived(permissions !== null && permissions.includes(TRUST_PERMISSIONS.manage));
  const readingPermissions = $derived(permissions === null);

  function manageRefusal(act: string): string | undefined {
    if (readingPermissions) return "Reading what this account may do.";
    return mayManage ? undefined : permissionRefusal(act, TRUST_PERMISSIONS.manage);
  }

  /**
   * What the Balance row's hover says where the ledger is served in a currency the account is not
   * held in. It is a fact about the money rather than a formatting detail, so it is stated instead
   * of being quietly rendered in the account's own currency.
   */
  function balanceTitle(balance: TrustDormantBalance): string | undefined {
    return balance.currency === currency
      ? undefined
      : `This ledger is served in ${balance.currency}, and the account is held in ${currency}.`;
  }

  /** What the list says when it has nothing to show, which is two different facts. */
  const listEmptyLine = $derived(
    quietOnOrBefore === "" ? QUIET_SINCE_UNANSWERED : NO_DORMANT_BALANCES,
  );

  function startOpening(balance: TrustDormantBalance): void {
    subjectBalance = balance;
    openingOpen = true;
  }

  function openFile(balance: TrustDormantBalance, reviewId: string): void {
    subjectBalance = balance;
    windowReviewId = reviewId;
    windowOpen = true;
  }

  /** A file was opened: read the ledgers again, and hand the reviewer the file they just opened. */
  function afterOpened(reviewId: string): void {
    const balance = subjectBalance;
    readBalances(trustAccountId, quietOnOrBefore);
    if (balance !== null) openFile(balance, reviewId);
  }
</script>

{#snippet failureLine(sentence: string)}
  <Alert.Root variant="warning">
    <Alert.Description>{sentence}</Alert.Description>
  </Alert.Root>
{/snippet}

<div class="flex flex-col gap-16">
  <!-- THE WINDOW THE READER STATES. No default, because the period a firm answers to is the
       state's and the kind of money's, and a pre-filled day would be this screen asserting one. -->
  <DatePicker
    label={QUIET_SINCE_LABEL}
    value={civilDateValue(quietOnOrBefore)}
    onValueChange={(next) => (quietOnOrBefore = civilDateTextOrEmpty(next))}
  />

  <LoadingRegion
    loading={reading}
    label="Reading the ledgers that have had no movement since that day"
    failed={balancesFailure !== null}
    onRetry={() => readBalances(trustAccountId, quietOnOrBefore)}
    class="flex flex-col gap-16"
  >
    {#snippet failure()}
      {@render failureLine(DORMANT_BALANCES_UNREADABLE)}
    {/snippet}

    {#each rows as balance (balance.trustLedgerNodeId)}
      {@const matter = matterDisplay(balance.matterId, matters.matters)}
      <div class="flex flex-col gap-8">
        <DefinitionList.Root>
          <DefinitionList.Row term="Matter" title={matter.title}>
            <!-- The matter's own Trust section, where the ledger itself is read. -->
            <a class="underline underline-offset-2" href={moneySectionHref(balance.matterId, "trust")}>
              {matter.text}
            </a>
          </DefinitionList.Row>
          <DefinitionList.Row term="Balance" title={balanceTitle(balance)}>
            <span class="tabular-nums">{money(balance.balanceMinor)}</span>
          </DefinitionList.Row>
          <DefinitionList.Row
            term="Earliest Receipt"
            empty={balance.earliestReceiptDate === null}
          >
            {balance.earliestReceiptDate === null ? "" : dayText(balance.earliestReceiptDate)}
          </DefinitionList.Row>
          <DefinitionList.Row term="Last Activity" empty={balance.lastActivityDate === null}>
            {balance.lastActivityDate === null ? "" : dayText(balance.lastActivityDate)}
          </DefinitionList.Row>
          <DefinitionList.Row
            term="Review"
            title={balance.openReviewId === null ? REVIEW_STANDING_NONE_MEANING : undefined}
          >
            {reviewStandingLabel(balance.openReviewId)}
          </DefinitionList.Row>
        </DefinitionList.Root>

        <div class="flex flex-wrap items-center gap-8">
          {#if balance.openReviewId === null}
            {@const refusal = manageRefusal("Opening a review")}
            <Button
              variant="secondary"
              size="sm"
              disabled={refusal !== undefined}
              title={refusal}
              onclick={() => startOpening(balance)}
            >
              Open Review
            </Button>
          {:else}
            {@const reviewId = balance.openReviewId}
            <Button variant="secondary" size="sm" onclick={() => openFile(balance, reviewId)}>
              Open
            </Button>
          {/if}
        </div>
      </div>
    {:else}
      <!-- The terms stand whether or not anything fills them, and the one line about the
           emptiness lives inside the list rather than beside it on the panel. -->
      <DefinitionList.Root>
        <DefinitionList.Row term="Matter" empty />
        <DefinitionList.Row term="Balance" empty />
        <DefinitionList.Row term="Earliest Receipt" empty />
        <DefinitionList.Row term="Last Activity" empty />
        <DefinitionList.Row term="Review" empty />
        <DefinitionList.Empty term="Matter">{listEmptyLine}</DefinitionList.Empty>
      </DefinitionList.Root>
    {/each}
  </LoadingRegion>
</div>

<UnclaimedFundsOpenReviewDialog
  bind:open={openingOpen}
  {trustAccountId}
  balance={subjectBalance}
  matterNumber={subjectMatterNumber}
  matterTitle={subjectMatterTitle}
  {money}
  onOpened={afterOpened}
/>

<UnclaimedFundsReviewWindow
  bind:open={windowOpen}
  reviewId={windowReviewId}
  matterNumber={subjectMatterNumber}
  matterTitle={subjectMatterTitle}
  {timeZone}
  {members}
  {money}
  attemptRefusal={manageRefusal("Recording a contact attempt")}
  closureRefusal={manageRefusal("Closing a review")}
  onWritten={() => readBalances(trustAccountId, quietOnOrBefore)}
/>
