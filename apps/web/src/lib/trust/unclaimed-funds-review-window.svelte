<script lang="ts">
  /*
   * One diligence file, whole: what was observed, every attempt to reach the owner, and how the
   * round ended.
   *
   * IT IS READ, NEVER EDITED. The file is a record of what the firm did and when it did it, so
   * nothing in it is corrected in place: a further attempt is appended, and a round that ended is
   * closed once. Edit stands refused with that reason rather than disappearing, and the window is
   * handed no way to commit a change, which is the other half of the same refusal.
   *
   * THE OBSERVATION IS WHAT THE REVIEWER SAW, NOT WHAT IS TRUE NOW. The balance, the earliest
   * receipt and the last activity are stored with the file as the read served them, and the ledger
   * may have moved since. The row says so rather than leaving a reader to compare it against the
   * ledger and wonder which one is wrong.
   *
   * AFTER EITHER WRITE THE FILE IS READ AGAIN, and the surface that opened this window is told, so
   * the quiet ledgers behind it stop naming a file that has just been closed.
   *
   * WHAT THE PAPER SAYS IS THE SAME THING: unclaimed-funds-sheet.ts renders this record for the
   * administrator or the counsel who asks the firm to produce its diligence.
   */
  import Button from "@magna-carta/design-system/button";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordWindow from "@magna-carta/design-system/record-window";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import type { Failure } from "$lib/api/problem.ts";
  import { LatestOnly } from "$lib/api/latest-only.ts";
  import {
    readTrustUnclaimedFundsReview,
    type TrustContactAttempt,
    type TrustUnclaimedFundsReview,
  } from "./trust-api.ts";
  import { dayText } from "./firm-trust-vocabulary.ts";
  import { memberDisplay } from "./trust-member-names.ts";
  import UnclaimedFundsRecordAttemptDialog from "./unclaimed-funds-record-attempt-dialog.svelte";
  import UnclaimedFundsCloseReviewDialog from "./unclaimed-funds-close-review-dialog.svelte";
  import { unclaimedFundsReviewSheet } from "./unclaimed-funds-sheet.ts";
  import {
    OBSERVATION_MEANING,
    REVIEW_UNREADABLE,
    contactChannelLabel,
    contactOutcomeLabel,
    matterHeading,
    reviewOutcomeLabel,
    reviewOutcomeMeaning,
  } from "./unclaimed-funds-vocabulary.ts";

  let {
    open = $bindable(false),
    reviewId,
    matterNumber,
    matterTitle,
    timeZone,
    members,
    money,
    attemptRefusal,
    closureRefusal,
    onWritten,
  }: {
    open?: boolean;
    /** The file to read, or null while the window holds none. */
    reviewId: string | null;
    matterNumber: string | null;
    matterTitle: string | null;
    /** The account's own zone, for the day an attempt defaults to. */
    timeZone: string;
    /** The firm's roster, for turning a user identifier into a name. Null while it is being read. */
    members: readonly FirmMemberSummary[] | null;
    money: (amountMinor: number) => string;
    /** Why this reader may not record an attempt, or undefined while they may. */
    attemptRefusal: string | undefined;
    /** Why this reader may not close the round, or undefined while they may. */
    closureRefusal: string | undefined;
    /** A write landed: the surface behind re-reads the quiet ledgers. */
    onWritten: () => void;
  } = $props();

  let review = $state<TrustUnclaimedFundsReview | null>(null);
  let reviewFailure = $state<Failure | null>(null);
  let reading = $state(false);
  const reads = new LatestOnly();

  let attemptOpen = $state(false);
  let closeOpen = $state(false);
  let printOpen = $state(false);

  /** The file this window is showing, read again from the top. Retry asks for the same file. */
  function readReview(identifier: string | null): void {
    reads.supersede();
    review = null;
    reviewFailure = null;
    reading = false;
    if (identifier === null) return;
    const attempt = reads.attempt();
    reading = true;
    void (async () => {
      const outcome = await readTrustUnclaimedFundsReview(fetch, identifier);
      // A file the reader has since moved past says nothing about this window.
      if (!attempt.current) return;
      reading = false;
      if (outcome.kind === "ok") {
        review = outcome.value;
        reviewFailure = null;
        return;
      }
      review = null;
      reviewFailure = outcome.failure;
    })();
  }

  $effect(() => {
    const identifier = open ? reviewId : null;
    readReview(identifier);
  });

  /** One member identifier as a name where the roster can say, and as itself where it cannot. */
  const asMember = (identifier: string) => memberDisplay(identifier, members);

  const heading = $derived(matterHeading(matterNumber, matterTitle));

  /*
   * The window names what it is showing rather than what it is about to do: a file is read here,
   * and the matter it stands over is the record it belongs to.
   */
  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Matter", number: matterNumber },
    facts: ["Unclaimed funds review"],
  });

  const attempts = $derived<readonly TrustContactAttempt[]>(review?.attempts ?? []);
  const closure = $derived(review?.closure ?? null);

  /** Why the round cannot be closed again, if it cannot. A closed file takes neither write. */
  const ROUND_ALREADY_CLOSED =
    "This round is already closed. A further search opens a new file over the same ledger.";
  const closedRefusal = $derived(closure === null ? undefined : ROUND_ALREADY_CLOSED);

  const EDIT_REFUSAL =
    "A diligence file is a record of what was done and when. An attempt is appended and a round is closed; nothing in it is corrected in place.";

  /*
   * The attempts, as the one table. Oldest first is the server's own order and the order a reader
   * works the record in, so nothing re-sorts it here.
   */
  const attemptColumns = (
    roster: readonly FirmMemberSummary[] | null,
  ): DataTable.GridColumn<TrustContactAttempt>[] => [
    {
      id: "attemptedOn",
      label: "Attempted On",
      type: "date",
      anchored: true,
      value: (attempt) => attempt.attemptedOn,
    },
    {
      id: "channel",
      label: "Channel",
      value: (attempt) => contactChannelLabel(attempt.channel),
    },
    {
      id: "contactUsed",
      label: "Contact Used",
      value: (attempt) => attempt.contactUsed,
    },
    {
      id: "outcome",
      label: "Outcome",
      value: (attempt) => contactOutcomeLabel(attempt.outcome),
    },
    {
      id: "recordedBy",
      label: "Recorded By",
      value: (attempt) => memberDisplay(attempt.recordedBy, roster).text,
    },
  ];

  const grid = DataTable.createDataTableGrid<TrustContactAttempt>({
    columns: () => attemptColumns(members),
    rows: () => [...attempts],
    rowKey: (attempt) => attempt.id,
    itemNoun: { singular: "attempt", plural: "attempts" },
  });

  /*
   * The note is the row's second line rather than a column: it is the one field on an attempt far
   * longer than everything beside it, and as a column it would be truncated to a few words or push
   * the facts off the pane. The line is offered only where the record carries one at all, so a file
   * of attempts nobody annotated does not stand a blank line under every row.
   */
  const anyNotes = $derived(attempts.some((attempt) => attempt.note !== null));

  const sheet = $derived(
    review === null
      ? null
      : unclaimedFundsReviewSheet(review, {
          matterNumber,
          matterTitle,
          money,
          memberName: (identifier) => asMember(identifier).text,
          printedAt: new Date(),
        }),
  );

  /** A write landed: read the file again, and tell the surface behind so its ledgers agree. */
  function afterWrite(): void {
    readReview(reviewId);
    onWritten();
  }
</script>

{#snippet failureLine(sentence: string)}
  <Alert.Root variant="warning">
    <Alert.Description>{sentence}</Alert.Description>
  </Alert.Root>
{/snippet}

{#snippet record()}
  <div class="flex flex-col gap-16">
    <LoadingRegion
      loading={reading}
      label="Reading this unclaimed-funds file"
      failed={reviewFailure !== null}
      onRetry={() => readReview(reviewId)}
      class="flex flex-col gap-16"
    >
      {#snippet failure()}
        {@render failureLine(REVIEW_UNREADABLE)}
      {/snippet}

      <!-- THE OBSERVATION — what the reviewer acted on, kept as they saw it. -->
      <DefinitionList.Root>
        <DefinitionList.Row term="Balance" title={OBSERVATION_MEANING} empty={review === null}>
          <span class="tabular-nums">
            {review === null ? "" : money(review.observedBalanceMinor)}
          </span>
        </DefinitionList.Row>
        <DefinitionList.Row term="Currency" empty={review === null}>
          {review === null ? "" : review.currency}
        </DefinitionList.Row>
        <DefinitionList.Row
          term="Earliest Receipt"
          empty={review === null || review.observedEarliestReceiptDate === null}
        >
          {review === null || review.observedEarliestReceiptDate === null
            ? ""
            : dayText(review.observedEarliestReceiptDate)}
        </DefinitionList.Row>
        <DefinitionList.Row
          term="Last Activity"
          empty={review === null || review.observedLastActivityDate === null}
        >
          {review === null || review.observedLastActivityDate === null
            ? ""
            : dayText(review.observedLastActivityDate)}
        </DefinitionList.Row>
        <DefinitionList.Row term="Opened By" empty={review === null}>
          {#if review !== null}
            {@const opener = asMember(review.openedBy)}
            <span title={opener.title}>{opener.text}</span>
          {/if}
        </DefinitionList.Row>
        <DefinitionList.Row term="Opened On" empty={review === null}>
          <span class="tabular-nums">{review === null ? "" : formatInstant(review.openedAt)}</span>
        </DefinitionList.Row>
        <DefinitionList.Row term="Note" empty={review === null || review.note === null}>
          {review?.note}
        </DefinitionList.Row>
        {#if review === null}
          <DefinitionList.Empty>The file has not been read yet.</DefinitionList.Empty>
        {/if}
      </DefinitionList.Root>

      <!-- HOW THE ROUND ENDED — the structure stands while the round is open, and says so. -->
      <DefinitionList.Root>
        <DefinitionList.Row
          term="Outcome"
          empty={closure === null}
          title={closure === null ? undefined : reviewOutcomeMeaning(closure.outcome)}
        >
          {closure === null ? "" : reviewOutcomeLabel(closure.outcome)}
        </DefinitionList.Row>
        <DefinitionList.Row
          term="Trust Movement"
          empty={closure === null || closure.trustMovementId === null}
        >
          {closure?.trustMovementId}
        </DefinitionList.Row>
        <DefinitionList.Row term="Closed By" empty={closure === null}>
          {#if closure !== null}
            {@const closer = asMember(closure.closedBy)}
            <span title={closer.title}>{closer.text}</span>
          {/if}
        </DefinitionList.Row>
        <DefinitionList.Row term="Closed On" empty={closure === null}>
          <span class="tabular-nums">
            {closure === null ? "" : formatInstant(closure.closedAt)}
          </span>
        </DefinitionList.Row>
        <DefinitionList.Row term="Closing Note" empty={closure === null || closure.note === null}>
          {closure?.note}
        </DefinitionList.Row>
        {#if closure === null}
          <DefinitionList.Empty term="Outcome">
            This round is open. Nothing has been recorded about how it ended.
          </DefinitionList.Empty>
        {/if}
      </DefinitionList.Root>
    </LoadingRegion>
  </div>
{/snippet}

{#snippet noteLine(attempt: TrustContactAttempt)}
  {attempt.note}
{/snippet}

{#snippet attemptsTab()}
  <div class="flex h-full min-h-0 flex-col gap-8">
    <LoadingRegion
      loading={reading}
      label="Reading the attempts on this file"
      failed={reviewFailure !== null}
      onRetry={() => readReview(reviewId)}
      class="flex min-h-0 flex-1 flex-col gap-8"
    >
      {#snippet failure()}
        {@render failureLine(REVIEW_UNREADABLE)}
      {/snippet}

      <DataTable.Grid
        {grid}
        caption="Attempts to reach the owner of this money"
        rowDetail={anyNotes ? noteLine : undefined}
        density="compact"
      />
    </LoadingRegion>
  </div>
{/snippet}

{#snippet actions()}
  <Button variant="secondary" onclick={() => (open = false)}>Close</Button>
  <Button
    variant="secondary"
    disabled={attemptRefusal !== undefined || closedRefusal !== undefined || review === null}
    title={attemptRefusal ?? closedRefusal}
    onclick={() => (attemptOpen = true)}
  >
    Record Attempt
  </Button>
  <Button
    variant="primary"
    disabled={closureRefusal !== undefined || closedRefusal !== undefined || review === null}
    title={closureRefusal ?? closedRefusal}
    onclick={() => (closeOpen = true)}
  >
    Close Review
  </Button>
{/snippet}

<RecordWindow
  bind:open
  {heading}
  {subtitle}
  {record}
  {actions}
  tabs={[{ key: "attempts", label: "Attempts", count: attempts.length, content: attemptsTab }]}
  editDisabledReason={EDIT_REFUSAL}
  unsavedChanges={false}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}

<UnclaimedFundsRecordAttemptDialog
  bind:open={attemptOpen}
  {reviewId}
  {matterNumber}
  {matterTitle}
  {timeZone}
  onRecorded={afterWrite}
/>

<UnclaimedFundsCloseReviewDialog
  bind:open={closeOpen}
  {reviewId}
  {matterNumber}
  {matterTitle}
  onClosed={afterWrite}
/>
