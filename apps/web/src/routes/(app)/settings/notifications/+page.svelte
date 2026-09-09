<script lang="ts">
  /*
   * Settings · Notifications — what THIS member hears, category by category, under My Settings.
   *
   * A MATRIX, not a page of rows. Every other settings page is one control per setting; this is one
   * subject with two independent answers — a feed row, and a line in a summary mail — and folding
   * them into separate rows would double the list and hide that they are the same decision made
   * twice. So it is a table: the category and what it carries, then its two channels.
   *
   * INSTANT, because it is the member's own. Their preference applies as the switch moves; there is
   * nothing here anybody reviews, and a Save button between a person and their own mail settings is
   * ceremony over their own business. Each change is one PATCH of one category.
   *
   * THE TWO CHANNELS COMPOSE IN OPPOSITE DIRECTIONS, and the server resolves that rather than this
   * page. In app the firm's tier is a floor it may raise and a member may not lower; by email the
   * member's tier wins outright, because forcing a copy into a mailbox that may be personal is a
   * different act from putting a row in a feed the platform controls. Every row arrives resolved,
   * saying whether it may be moved and who decided; a locked switch renders locked with the reason
   * beside it rather than as a control that silently refuses.
   *
   * WHAT SILENCE COST IS SHOWN. A preference system fails by being quiet: something did not arrive
   * and nothing says a setting is why. The server counts each suppression per category, so a
   * category the member switched off says how much it has held back and since when — which is what
   * makes turning it off a decision rather than a disappearance.
   */
  import Badge from "@magna-carta/design-system/badge";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import * as Select from "@magna-carta/design-system/select";
  import Switch from "@magna-carta/design-system/switch";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import type { Failure } from "$lib/api/request.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    EMAIL_CADENCE_OPTIONS,
    notificationCategoryDescription,
    notificationCategoryLabel,
    type NotificationCategory,
    type NotificationEmailCadence,
  } from "$lib/notifications/category-vocabulary.ts";
  import {
    readNotificationPreferences,
    updateNotificationPreferences,
    type NotificationPreferences,
    type NotificationPreferencesPatch,
    type ResolvedCategoryPreference,
  } from "$lib/notifications/preferences-api.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";

  let preferences = $state<NotificationPreferences | null>(null);
  let readFailure = $state<Failure | null>(null);
  let reading = $state(false);
  let writeFailure = $state<StatedFailure | null>(null);
  /** The categories with a write in flight, so one row's switch cannot be moved twice at once. */
  let inFlight = $state<NotificationCategory[]>([]);

  async function load(): Promise<void> {
    readFailure = null;
    reading = true;
    const outcome = await readNotificationPreferences(fetch);
    reading = false;
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    preferences = outcome.value;
  }

  $effect(() => {
    void load();
  });

  const rows = $derived(preferences?.categories ?? []);

  /** How many the member's own choice has held back, and null where none has been. */
  function suppressed(category: NotificationCategory): number | null {
    const total = (preferences?.suppressedInApp ?? [])
      .filter((tally) => tally.category === category)
      .reduce((count, tally) => count + tally.count, 0);
    return total === 0 ? null : total;
  }

  function lockReason(row: ResolvedCategoryPreference): string | null {
    if (row.inAppLockedBy === "mandatory") {
      return "Always on. The firm cannot be in a position where nobody was told.";
    }
    if (row.inAppLockedBy === "firm-policy") {
      return "Your firm has decided everybody hears this one.";
    }
    return null;
  }

  async function change(
    category: NotificationCategory,
    change: { inApp?: "on" | "off"; email?: NotificationEmailCadence },
  ): Promise<void> {
    if (inFlight.includes(category)) return;
    writeFailure = null;
    inFlight = [...inFlight, category];
    const patch: NotificationPreferencesPatch = { [category]: change };
    const outcome = await updateNotificationPreferences(fetch, patch, crypto.randomUUID());
    inFlight = inFlight.filter((pending) => pending !== category);
    if (outcome.kind === "ok") {
      // The server's answer is the whole resolved matrix, so the row settles on what APPLIES rather
      // than on what was asked for — which is how a change the firm's floor overrides shows itself.
      preferences = outcome.value;
      return;
    }
    writeFailure = stated(
      outcome.failure,
      `${notificationCategoryLabel(category)} was not changed.`,
      "Nothing answered, so nothing changed; choosing again tries once more.",
    );
    // The screen still shows the old value, because the read is the only thing that changed it.
  }

  // The shape drawn while the matrix is read: three rows in the table's own columns. Category names
  // are this page's own vocabulary, which the sample words do not carry.
  const FIXTURE = ["deadlines", "tasks", "billing"] as const;
</script>

<svelte:head>
  <title>Notifications · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="notifications"
  title="Notifications"
  posture="instant"
  showHistory={false}
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. -->
<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsDescription>
      What you hear about, and how. In-app rows appear in your own feed; email arrives as a summary
      rather than a message per event.
    </SettingsDescription>

    {#if writeFailure !== null}
      <FailureNotice
        failure={writeFailure.failure}
        fallback={writeFailure.fallback}
        whenSilent={writeFailure.whenSilent}
      />
    {/if}

    <SettingsPlate heading="What You Hear">
      <LoadingRegion
        loading={preferences === null}
        failed={readFailure !== null && preferences === null}
        refreshing={reading && preferences !== null}
        label="Reading your notification preferences"
        onRetry={() => void load()}
        class="flex flex-col"
      >
        {#snippet failure()}
          {#if readFailure !== null}
            <FailureNotice
              failure={readFailure}
              title="Your Preferences Could Not Be Read"
              fallback="Your notification preferences were not read."
              onRetry={() => void load()}
            />
          {/if}
        {/snippet}
        {#snippet fixture()}
          <DataTable.Root>
            <DataTable.Header>
              <DataTable.Row>
                <DataTable.Head>Category</DataTable.Head>
                <DataTable.Head>In app</DataTable.Head>
                <DataTable.Head>Email</DataTable.Head>
              </DataTable.Row>
            </DataTable.Header>
            <DataTable.Body>
              {#each FIXTURE as category (category)}
                <DataTable.Row>
                  <DataTable.Cell>{notificationCategoryLabel(category)}</DataTable.Cell>
                  <DataTable.Cell><Switch disabled checked /></DataTable.Cell>
                  <DataTable.Cell>Daily summary</DataTable.Cell>
                </DataTable.Row>
              {/each}
            </DataTable.Body>
          </DataTable.Root>
        {/snippet}

        {#if readFailure !== null}
          <FailureNotice
            failure={readFailure}
            title="Your Preferences Were Not Re-read"
            fallback="What is shown was read and stands."
            onRetry={() => void load()}
          />
        {/if}

        {#if rows.length > 0}
          <DataTable.Root>
            <DataTable.Caption class="sr-only">
              What you are told about, by category and channel
            </DataTable.Caption>
            <DataTable.Header>
              <DataTable.Row>
                <DataTable.Head>Category</DataTable.Head>
                <DataTable.Head>In app</DataTable.Head>
                <DataTable.Head>Email</DataTable.Head>
              </DataTable.Row>
            </DataTable.Header>
            <DataTable.Body>
              {#each rows as row (row.category)}
                {@const locked = lockReason(row)}
                {@const held = suppressed(row.category)}
                <DataTable.Row>
                  <DataTable.Cell>
                    <span class="flex flex-col gap-2">
                      <span class="font-medium">{notificationCategoryLabel(row.category)}</span>
                      <span class="text-xs text-text-muted">
                        {notificationCategoryDescription(row.category)}
                      </span>
                      {#if held !== null}
                        <!-- What the choice has cost, said where the choice was made. -->
                        <span class="text-xs text-text-muted">
                          {held}
                          {held === 1 ? "notification" : "notifications"} held back since
                          {preferences?.suppressedSinceCivilDate}
                        </span>
                      {/if}
                    </span>
                  </DataTable.Cell>
                  <DataTable.Cell>
                    {#if locked !== null}
                      <!-- Locked reads as locked, with the reason on the hover: a switch that
                           silently refuses to move reads as a broken control. -->
                      <Tooltip.Root>
                        <Tooltip.Trigger>
                          <Badge variant="neutral">Always on</Badge>
                        </Tooltip.Trigger>
                        <Tooltip.Content>{locked}</Tooltip.Content>
                      </Tooltip.Root>
                    {:else}
                      <Switch
                        checked={row.inApp === "on"}
                        disabled={inFlight.includes(row.category)}
                        aria-label="{notificationCategoryLabel(row.category)} in app"
                        onCheckedChange={(next) =>
                          void change(row.category, { inApp: next ? "on" : "off" })}
                      />
                    {/if}
                  </DataTable.Cell>
                  <DataTable.Cell>
                    <Select.Root
                      type="single"
                      items={[...EMAIL_CADENCE_OPTIONS]}
                      value={row.email}
                      allowDeselect={false}
                      disabled={inFlight.includes(row.category)}
                      onValueChange={(next) =>
                        void change(row.category, { email: next as NotificationEmailCadence })}
                    >
                      <Select.Trigger
                        class="w-full"
                        aria-label="{notificationCategoryLabel(row.category)} email"
                      >
                        <Select.Value placeholder="No email" />
                      </Select.Trigger>
                      <Select.Content>
                        {#each EMAIL_CADENCE_OPTIONS as option (option.value)}
                          <Select.Item value={option.value} label={option.label} />
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  </DataTable.Cell>
                </DataTable.Row>
              {/each}
            </DataTable.Body>
          </DataTable.Root>
        {/if}
      </LoadingRegion>
    </SettingsPlate>
  </div>
</div>
