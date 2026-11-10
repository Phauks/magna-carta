<script lang="ts">
  /*
   * Settings · Calendar Sync — which of the member's event types go to which of their own
   * calendars at the provider.
   *
   * ITS OWN PAGE, by the owner's ruling: the account is held on Connected Accounts, and what is
   * done with it for the calendar is decided here, apart from anything mail will ever do.
   *
   * ONE ROW PER EVENT TYPE, never a group of them. A type the firm adds later appears as a row
   * that is not synced, because no rule exists for it until the member makes one.
   *
   * NOTHING SYNCS UNLESS A ROW SAYS SO, and the firm's limit is the outer edge: a type the firm
   * does not let leave says so on its row and offers no change.
   *
   * A CHANGE IS ONE ROW AT A TIME, through its own window, committed at once: the catalog-page
   * pattern, where there is no staged page-wide draft to save or lose.
   *
   * A COPY THAT DIFFERS IN OUTLOOK AND WAS NOT CARRIED BACK IS A QUESTION. An edit a member may
   * make is applied to the event by the sync pass and never reaches this page. What does reach it
   * is a copy they deleted, which never cancels anything, and an edit that could not be carried
   * (they may not edit the calendar, or it moved a series' first day). The copy appears in its own plate, above the rules, with what was sent beside what
   * Outlook holds, and two answers: Put Back, or Leave It. An event Outlook would not take at all
   * sits in the same plate, because it is the same fact to the reader (Outlook does not have what
   * Magna Carta has), with Try Again and Dismiss. The plate is absent while there is nothing to
   * answer.
   *
   * WHEN THE PROVIDER CANNOT BE ASKED the page still shows what is saved, with each rule's
   * calendar under the name it had when saved, and offers no change: a rule can only be saved
   * against the account's calendars as they stand.
   */
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    calendarSyncListMyIssuesOptions,
    calendarSyncListMyIssuesQueryKey,
    calendarSyncReadMineOptions,
    calendarSyncReadMineQueryKey,
    type CalendarSyncIssue,
    type CalendarSyncIssueList,
    type CalendarSyncSettings,
  } from "@magna-carta/api-client";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { issueKey, syncIssueColumns } from "$lib/calendar-sync/sync-issues.ts";
  import { answerSyncIssue, saveMyRules } from "$lib/calendar-sync/sync-settings-api.ts";
  import {
    destinationChoices,
    memberSyncColumns,
    memberSyncRows,
    NOT_SYNCED,
    rulesWithChange,
    scopeChoices,
    subjectName,
    SYNC_ACTIONS_COLUMN_ID,
    syncingSummary,
    type MemberSyncRow,
    type SyncScope,
  } from "$lib/calendar-sync/sync-settings.ts";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";

  const queryClient = useQueryClient();
  const settings = createQuery(() => calendarSyncReadMineOptions());

  const account = $derived(settings.data?.account ?? null);
  const calendars = $derived(settings.data?.calendars ?? null);
  // A change needs the account's calendars as they stand now, so without them nothing is offered.
  const canChange = $derived(account !== null && calendars !== null);
  const rows = $derived(memberSyncRows(settings.data?.subjects ?? [], settings.data?.rules ?? []));

  const grid = $derived(
    DataTable.createDataTableGrid<MemberSyncRow>({
      columns: () => memberSyncColumns(canChange),
      rows: () => rows,
      rowKey: (row) => row.subject.subject,
      itemNoun: { singular: "event type", plural: "event types" },
    }),
  );

  const issues = createQuery(() => calendarSyncListMyIssuesOptions());
  const openIssues = $derived(issues.data?.issues ?? []);
  const issueGrid = $derived(
    DataTable.createDataTableGrid<CalendarSyncIssue>({
      columns: syncIssueColumns,
      rows: () => openIssues,
      rowKey: issueKey,
      itemNoun: { singular: "event", plural: "events" },
    }),
  );
  // The copy being answered for, so its two buttons cannot be pressed twice.
  let answering = $state<string | null>(null);
  let answerRefusal = $state<string | null>(null);

  async function answer(issue: CalendarSyncIssue, choice: "putBack" | "leave"): Promise<void> {
    answering = issueKey(issue);
    answerRefusal = null;
    const outcome = await answerSyncIssue(issue, choice);
    answering = null;
    if (outcome.kind === "refused") {
      answerRefusal = outcome.detail ?? "Your answer was not saved. Nothing changed.";
      return;
    }
    queryClient.setQueryData<CalendarSyncIssueList>(
      calendarSyncListMyIssuesQueryKey(),
      outcome.value,
    );
  }

  let changing = $state<MemberSyncRow | null>(null);
  let changeOpen = $state(false);
  let destination = $state(NOT_SYNCED);
  let scope = $state<SyncScope>("mine");
  let since = $state({ destination: NOT_SYNCED, scope: "mine" as SyncScope });
  let refusal = $state<string | null>(null);

  const started = $derived(destination !== since.destination || scope !== since.scope);

  function openChange(row: MemberSyncRow): void {
    changing = row;
    // A rule pointing at a calendar the account no longer has opens as not synced, so saving the
    // window as it stands never re-saves a destination that is gone.
    const standing =
      row.rule !== null &&
      (calendars ?? []).some((calendar) => calendar.remoteId === row.rule?.calendarRemoteId)
        ? row.rule.calendarRemoteId
        : NOT_SYNCED;
    destination = standing;
    scope = row.rule?.scope ?? "mine";
    since = { destination, scope };
    refusal = null;
    changeOpen = true;
  }

  function chooseScope(next: string): void {
    if (next === "mine" || next === "my_matters") scope = next;
  }

  async function commitChange(): Promise<ActionOutcome> {
    if (changing === null || settings.data === undefined) return "refused";
    refusal = null;
    const outcome = await saveMyRules(
      rulesWithChange(settings.data.rules, changing.subject.subject, {
        calendarRemoteId: destination,
        scope,
      }),
    );
    if (outcome.kind === "refused") {
      refusal = outcome.detail ?? "The change was not saved. Nothing changed.";
      return "refused";
    }
    queryClient.setQueryData<CalendarSyncSettings>(calendarSyncReadMineQueryKey(), outcome.value);
    return "committed";
  }
</script>

<svelte:head><title>Calendar Sync · Settings · Magna Carta</title></svelte:head>

{#snippet syncCell({ row, column, text }: DataTable.GridCellContext<MemberSyncRow>)}
  {#if column.id === SYNC_ACTIONS_COLUMN_ID}
    {#if row.subject.mayLeave}
      <Button variant="ghost" size="sm" onclick={() => openChange(row)}>Change</Button>
    {/if}
  {:else if column.id === "destination" && (row.rule === null || !row.subject.mayLeave)}
    <span class="text-text-muted">{text}</span>
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet issueCell({ row, column, text }: DataTable.GridCellContext<CalendarSyncIssue>)}
  {#if column.id === SYNC_ACTIONS_COLUMN_ID}
    <div class="flex items-center gap-4">
      <Button
        variant="ghost"
        size="sm"
        disabled={answering !== null}
        onclick={() => void answer(row, "putBack")}
      >
        {row.kind === "not_sent" ? "Try Again" : "Put Back"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={answering !== null}
        onclick={() => void answer(row, "leave")}
      >
        {row.kind === "not_sent" ? "Dismiss" : "Leave It"}
      </Button>
    </div>
  {:else}
    {text}
  {/if}
{/snippet}

<SettingsMasthead
  sectionId="calendar-sync"
  title="Calendar Sync"
  posture={canChange ? "instant" : "readOnly"}
  showHistory={false}
/>

<SettingsScrollRegion>
  {#if openIssues.length > 0}
    <SettingsPlate heading="Different in Outlook">
      <SettingsDescription>
        These are not the same in Outlook as in Magna Carta: you changed or deleted the copy there,
        or Outlook would not take the event. Magna Carta's calendar was not changed. Put Back writes
        the event to Outlook again as Magna Carta has it. Leave It keeps Outlook as it is.
      </SettingsDescription>
      {#if answerRefusal !== null}
        <Alert.Root variant="danger">
          <Alert.Description>{answerRefusal}</Alert.Description>
        </Alert.Root>
      {/if}
      <DataTable.Grid grid={issueGrid} caption="Events that are different in Outlook" cell={issueCell} />
    </SettingsPlate>
  {/if}

  <SettingsPlate heading="From Magna Carta to Outlook">
    <SettingsDescription>
      Nothing syncs unless a row below says so. A new event type starts as Not Synced until you
      choose where it goes.
    </SettingsDescription>

    <LoadingRegion
      loading={settings.isPending}
      failed={settings.isError}
      label="Reading your calendar sync settings"
      onRetry={() => void settings.refetch()}
      class="flex flex-col gap-16"
    >
      {#snippet failure()}
        <p class="py-12 text-sm text-text-muted">
          Your calendar sync settings could not be read, so they are not stated rather than guessed
          at.
        </p>
      {/snippet}

      {#if account === null}
        <Alert.Root variant="info">
          <Alert.Title>No account is connected</Alert.Title>
          <Alert.Description>
            Connect your Outlook account in
            <a class="underline underline-offset-2" href="/settings/connected-accounts">
              Connected Accounts
            </a>
            and then choose here which event types go to it.
          </Alert.Description>
        </Alert.Root>
      {:else if account.status === "needs_reauth"}
        <Alert.Root variant="warning">
          <Alert.Title>Outlook needs you to sign in again</Alert.Title>
          <Alert.Description>
            Your settings are kept. Connect again in
            <a class="underline underline-offset-2" href="/settings/connected-accounts">
              Connected Accounts
            </a>
            to change them.
          </Alert.Description>
        </Alert.Root>
      {:else if calendars === null}
        <Alert.Root variant="warning">
          <Alert.Title>Your Outlook calendars could not be read</Alert.Title>
          <Alert.Description>
            What you saved is shown below. It can be changed once Outlook answers again.
          </Alert.Description>
        </Alert.Root>
      {/if}

      <DataTable.Grid {grid} caption="Your calendar sync rules" cell={syncCell} />
      <DataTable.GridFooter {grid} />
    </LoadingRegion>

    {#if account !== null && settings.data !== undefined}
      <SettingsPlateNote>
        {syncingSummary(settings.data.rules)} Connected as
        {account.accountLabel ?? "your Microsoft 365 account"}.
      </SettingsPlateNote>
    {/if}
  </SettingsPlate>
</SettingsScrollRegion>

<ActionDialog
  bind:open={changeOpen}
  heading={changing === null ? "Change Sync" : `Change Sync for ${subjectName(changing.subject)}`}
  commitLabel="Save Changes"
  commitBusyLabel="Saving"
  unsavedChanges={started}
  onCommit={commitChange}
>
  {#snippet notice()}
    {#if refusal !== null}
      <Alert.Root variant="danger">
        <Alert.Description>{refusal}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}
  {#snippet fields()}
    {#if changing !== null}
      <div class="flex flex-col gap-16">
        <div class="flex flex-col gap-4">
          <Label for="calendar-sync-destination">Send To</Label>
          <ChoicePicker
            options={destinationChoices(calendars ?? [])}
            inputId="calendar-sync-destination"
            label="Send To"
            bind:value={destination}
          />
        </div>
        {#if destination !== NOT_SYNCED}
          <div class="flex flex-col gap-4">
            <Label for="calendar-sync-scope">Which Ones</Label>
            <ChoicePicker
              options={scopeChoices(changing.subject.kind)}
              inputId="calendar-sync-scope"
              label="Which Ones"
              bind:value={() => scope, chooseScope}
            />
          </div>
        {/if}
        {#if changing.subject.detail === "minimal"}
          <p class="text-sm text-text-muted">
            The firm sends this type with the matter number and the type only.
          </p>
        {/if}
      </div>
    {/if}
  {/snippet}
</ActionDialog>
