<script lang="ts">
  /*
   * Settings · Calendar Sync (firm) — the outer limit on what may be copied to members' own
   * calendars at a provider, under Practice.
   *
   * A MEMBER CAN SYNC LESS THAN THIS AND NEVER MORE. For each event type, and for deadlines, the
   * firm says whether it may leave Magna Carta at all and with how much detail. A member's own
   * rules live on their own page and stay inside what is set here.
   *
   * ONE ROW PER EVENT TYPE, never a group of them, by the owner's ruling.
   *
   * A CHANGE IS ONE ROW AT A TIME, through its own window. Stopping a type from leaving removes
   * every member's rule for it in the same act, and the window says so before it is done, which is
   * why this is a window with a named commit and not a switch in the row.
   *
   * THE EDIT RIGHT IS `calendar:manageSyncPolicy`, read from the session. Without it the server
   * refuses the read as well, and the page says so.
   */
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    calendarSyncReadFirmLimitsOptions,
    calendarSyncReadFirmLimitsQueryKey,
    type CalendarSyncFirmLimits,
    type CalendarSyncSubject,
  } from "@magna-carta/api-client";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import {
    MANAGE_SYNC_POLICY_PERMISSION,
    setFirmLimit,
  } from "$lib/calendar-sync/sync-settings-api.ts";
  import {
    DETAIL_CHOICES,
    firmLimitColumns,
    MAY_LEAVE_CHOICES,
    subjectName,
    SYNC_ACTIONS_COLUMN_ID,
    type SyncDetail,
  } from "$lib/calendar-sync/sync-settings.ts";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";

  const queryClient = useQueryClient();
  const limits = createQuery(() => calendarSyncReadFirmLimitsOptions());

  // Read-only until the session says otherwise: a control that appears and then vanishes when the
  // permission turns out to be missing reads as a broken page.
  const canEdit = $derived(sessionPermissions.holds(MANAGE_SYNC_POLICY_PERMISSION));

  $effect(() => {
    void sessionPermissions.load(fetch);
  });

  const grid = $derived(
    DataTable.createDataTableGrid<CalendarSyncSubject>({
      columns: () => firmLimitColumns(canEdit),
      rows: () => limits.data?.subjects ?? [],
      rowKey: (subject) => subject.subject,
      itemNoun: { singular: "event type", plural: "event types" },
    }),
  );

  let changing = $state<CalendarSyncSubject | null>(null);
  let changeOpen = $state(false);
  let mayLeave = $state(true);
  let detail = $state<SyncDetail>("full");
  let since = $state({ mayLeave: true, detail: "full" as SyncDetail });
  let refusal = $state<string | null>(null);

  const started = $derived(mayLeave !== since.mayLeave || detail !== since.detail);
  // Stopping a type that could leave until now is the one change that takes something away.
  const closing = $derived(since.mayLeave && !mayLeave);

  function openChange(subject: CalendarSyncSubject): void {
    changing = subject;
    mayLeave = subject.mayLeave;
    detail = subject.detail;
    since = { mayLeave, detail };
    refusal = null;
    changeOpen = true;
  }

  function chooseMayLeave(next: string): void {
    mayLeave = next === "yes";
  }

  function chooseDetail(next: string): void {
    if (next === "full" || next === "minimal") detail = next;
  }

  async function commitChange(): Promise<ActionOutcome> {
    if (changing === null) return "refused";
    refusal = null;
    const outcome = await setFirmLimit({ subject: changing.subject, mayLeave, detail });
    if (outcome.kind === "refused") {
      refusal = outcome.detail ?? "The change was not saved. Nothing changed.";
      return "refused";
    }
    queryClient.setQueryData<CalendarSyncFirmLimits>(
      calendarSyncReadFirmLimitsQueryKey(),
      outcome.value,
    );
    return "committed";
  }
</script>

<svelte:head><title>Calendar Sync · Firm Settings · Magna Carta</title></svelte:head>

{#snippet limitCell({ row, column, text }: DataTable.GridCellContext<CalendarSyncSubject>)}
  {#if column.id === SYNC_ACTIONS_COLUMN_ID}
    <Button variant="ghost" size="sm" onclick={() => openChange(row)}>Change</Button>
  {:else}
    {text}
  {/if}
{/snippet}

<SettingsMasthead
  sectionId="calendar-sync-policy"
  title="Calendar Sync"
  posture={canEdit ? "instant" : "readOnly"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsPlate heading="What May Leave Magna Carta">
    <SettingsDescription>
      The firm's limit on what members may copy to their own Outlook calendars. A member can sync
      less than this and never more.
    </SettingsDescription>

    <LoadingRegion
      loading={limits.isPending}
      failed={limits.isError}
      label="Reading the firm's calendar sync limits"
      onRetry={() => void limits.refetch()}
      class="flex flex-col gap-16"
    >
      {#snippet failure()}
        <p class="py-12 text-sm text-text-muted">
          The firm's calendar sync limits could not be read. They are open to members who set firm
          policy.
        </p>
      {/snippet}

      <DataTable.Grid {grid} caption="The firm's calendar sync limits" cell={limitCell} />
      <DataTable.GridFooter {grid} />
    </LoadingRegion>

    <SettingsPlateNote>
      A type sent with the matter number and type only carries no title, location or notes. Nothing
      leaves on the strength of this page alone: each member still chooses what they send.
    </SettingsPlateNote>
  </SettingsPlate>
</SettingsScrollRegion>

<ActionDialog
  bind:open={changeOpen}
  kind={closing ? "destructive" : "form"}
  heading={changing === null ? "Change the Limit" : `Change the Limit for ${subjectName(changing)}`}
  commitLabel={closing ? "Stop It Leaving" : "Save Changes"}
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
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-4">
        <Label for="calendar-sync-may-leave">May Leave Magna Carta</Label>
        <ChoicePicker
          options={MAY_LEAVE_CHOICES}
          inputId="calendar-sync-may-leave"
          label="May Leave Magna Carta"
          bind:value={() => (mayLeave ? "yes" : "no"), chooseMayLeave}
        />
      </div>
      {#if mayLeave}
        <div class="flex flex-col gap-4">
          <Label for="calendar-sync-detail">Detail Sent</Label>
          <ChoicePicker
            options={DETAIL_CHOICES}
            inputId="calendar-sync-detail"
            label="Detail Sent"
            bind:value={() => detail, chooseDetail}
          />
        </div>
      {/if}
      {#if closing}
        <p class="text-sm text-text-muted">
          Every member's rule for this type is removed, so it stops syncing for all of them. Allowing
          it again later does not bring those rules back: each member chooses again.
        </p>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
