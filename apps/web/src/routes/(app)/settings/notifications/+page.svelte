<script lang="ts">
  /*
   * Settings · Notifications — what THIS member hears, category by category, under My Settings.
   *
   * A MATRIX, not a page of rows. Every other settings page is one control per setting; this is one
   * subject with two independent answers — a feed row, and a line in a summary mail — and folding
   * them into separate rows would double the list and hide that they are the same decision made
   * twice. So it is the product's one table (catalog-columns.ts declares its columns): the
   * category, then its two channels, sortable and filterable like every other register, with the
   * category's meaning as the row's second line rather than a column.
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
   * beside it rather than as a control that silently refuses. The switch itself is bound to the
   * resolved row through a getter/setter, so it shows what APPLIES: a change the firm's floor
   * overrides settles back to the floor rather than to what was pressed.
   *
   * WHAT SILENCE COST IS SHOWN. A preference system fails by being quiet: something did not arrive
   * and nothing says a setting is why. The server counts each suppression per category, so a
   * category the member switched off says how much it has held back and since when — which is what
   * makes turning it off a decision rather than a disappearance.
   */
  import Badge from "@magna-carta/design-system/badge";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Switch from "@magna-carta/design-system/switch";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
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
  import { notificationPreferenceColumns } from "$lib/settings/catalog-columns.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";

  let preferences = $state<NotificationPreferences | null>(null);
  let readFailure = $state<Failure | null>(null);
  let writeFailure = $state<StatedFailure | null>(null);
  /** The categories with a write in flight, so one row's switch cannot be moved twice at once. */
  let inFlight = $state<NotificationCategory[]>([]);

  async function load(): Promise<void> {
    readFailure = null;
    const outcome = await readNotificationPreferences(fetch);
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

  const grid = DataTable.createDataTableGrid<ResolvedCategoryPreference>({
    columns: () => notificationPreferenceColumns(),
    rows: () => rows,
    rowKey: (row) => row.category,
    itemNoun: { singular: "category", plural: "categories" },
  });

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

  function cadenceFromValue(value: string): NotificationEmailCadence | null {
    return EMAIL_CADENCE_OPTIONS.find((option) => option.value === value)?.value ?? null;
  }

  async function change(
    category: NotificationCategory,
    asked: { inApp?: "on" | "off"; email?: NotificationEmailCadence },
  ): Promise<void> {
    if (inFlight.includes(category)) return;
    writeFailure = null;
    inFlight = [...inFlight, category];
    const patch: NotificationPreferencesPatch = { [category]: asked };
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
      "Couldn't connect. Nothing changed. Try again.",
    );
    // The screen still shows the old value, because the read is the only thing that changed it.
  }
</script>

<svelte:head>
  <title>Notifications · Settings · Magna Carta</title>
</svelte:head>

{#snippet preferenceCell({ row, column, text }: DataTable.GridCellContext<ResolvedCategoryPreference>)}
  {#if column.id === "inApp"}
    {@const locked = lockReason(row)}
    {#if locked !== null}
      <!-- Locked reads as locked, with the reason on the hover: a switch that silently refuses to
           move reads as a broken control. -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          <Badge variant="neutral">{text}</Badge>
        </Tooltip.Trigger>
        <Tooltip.Content>{locked}</Tooltip.Content>
      </Tooltip.Root>
    {:else}
      <Switch
        bind:checked={
          () => row.inApp === "on",
          (next) => void change(row.category, { inApp: next ? "on" : "off" })
        }
        disabled={inFlight.includes(row.category)}
        aria-label="{notificationCategoryLabel(row.category)} in app"
      />
    {/if}
  {:else if column.id === "email"}
    <ChoicePicker
      options={EMAIL_CADENCE_OPTIONS}
      label="{notificationCategoryLabel(row.category)} email"
      disabled={inFlight.includes(row.category)}
      bind:value={
        () => row.email,
        (next) => {
          const email = cadenceFromValue(next);
          if (email !== null) void change(row.category, { email });
        }
      }
    />
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet categoryDetail(row: ResolvedCategoryPreference)}
  {@const held = suppressed(row.category)}
  <span class="flex flex-col gap-2 text-xs text-text-muted">
    <span>{notificationCategoryDescription(row.category)}</span>
    {#if held !== null}
      <!-- What the choice has cost, said where the choice was made. -->
      <span>
        {held}
        {held === 1 ? "notification" : "notifications"} held back since
        {preferences?.suppressedSinceCivilDate}
      </span>
    {/if}
  </span>
{/snippet}

<SettingsMasthead sectionId="notifications" title="Notifications" posture="instant" showHistory={false} />

<SettingsScrollRegion>
  <SettingsDescription>
    What you're notified about, and how. In-app notifications go to your feed; email comes as a summary.
  </SettingsDescription>

  {#if writeFailure !== null}
    <FailureNotice
      failure={writeFailure.failure}
      fallback={writeFailure.fallback}
      whenSilent={writeFailure.whenSilent}
    />
  {/if}

  <SettingsPlate heading="What You Hear">
    {#if grid.isFiltered}
      <div class="flex items-center justify-end gap-8 py-12">
        <DataTable.ClearFilters {grid} />
      </div>
    {/if}
    {#if readFailure !== null && preferences === null}
      <FailureNotice
        failure={readFailure}
        title="Your Preferences Could Not Be Read"
        fallback="Your notification preferences were not read."
        onRetry={() => void load()}
      />
    {:else}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="Your Preferences Were Not Re-read"
          fallback="What is shown was read and stands."
          onRetry={() => void load()}
        />
      {/if}
      <DataTable.Grid
        {grid}
        caption="What you are told about, by category and channel"
        cell={preferenceCell}
        rowDetail={categoryDetail}
        loading={preferences === null}
        placeholderCount={3}
      />
      <DataTable.GridFooter {grid} />
    {/if}
  </SettingsPlate>
</SettingsScrollRegion>
