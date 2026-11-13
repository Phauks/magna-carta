<script lang="ts">
  /*
   * Settings · Notification Policy — the three levers the FIRM holds over what the platform tells
   * its members, under Practice. The member's own switches are Settings · Notifications, under My
   * Settings, and the two are deliberately separate surfaces: one binds the person reading it, the
   * other binds everybody else.
   *
   * THE TWO CHANNELS ARE NOT SYMMETRICAL. In app, "Everyone hears this" is a FLOOR nobody may lower
   * — that is what makes it worth having. "Off" is only a firm-wide default a member may raise,
   * because a firm has no legitimate interest in stopping somebody hearing about their own work. By
   * email nothing here is a ceiling at all: every value is a default and a member's own cadence
   * always wins, because forcing a copy into a mailbox that may be personal and is beyond both the
   * audit log and the visibility filter is not a thing a firm may do to somebody. The page says all
   * of that in the controls rather than in a paragraph nobody reads.
   *
   * THE MATRIX IS THE PRODUCT'S ONE TABLE (catalog-columns.ts declares its columns), with the
   * category's meaning as the row's second line; the two scalars beneath it are settings rows in
   * the shared anatomy, each committing on its own as it is left.
   *
   * INSTANT, and the departure from mode-follows-scope is deliberate — the same one Users makes.
   * This is a matrix of twelve rows and two scalars; staging twenty-six independently meaningful
   * choices behind one Save would make the pending count meaningless and the recap unreadable, and
   * each change here is one write the route audits on its own. The masthead states the posture.
   *
   * WHAT IS NOT HERE: the trust-compliance designation. It is a firm setting too, but it names
   * PEOPLE rather than policy and sits behind trust:manage on the preferences route.
   */
  import Badge from "@magna-carta/design-system/badge";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Input from "@magna-carta/design-system/input";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { Failure } from "$lib/api/request.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import {
    notificationCategoryDescription,
    notificationCategoryLabel,
    type NotificationCategory,
    type NotificationEmailCadence,
    type NotificationInAppChoice,
  } from "$lib/notifications/category-vocabulary.ts";
  import {
    MANAGE_NOTIFICATION_POLICY_PERMISSION,
    MAX_DIGEST_LOCAL_HOUR,
    MAX_RETENTION_DAYS,
    MIN_DIGEST_LOCAL_HOUR,
    MIN_RETENTION_DAYS,
    readFirmNotificationPolicy,
    updateFirmNotificationPolicy,
    type FirmCategoryPolicy,
    type FirmNotificationPolicy,
    type FirmNotificationPolicyPatch,
  } from "$lib/notifications/firm-policy-api.ts";
  import {
    EMAIL_POLICY_OPTIONS,
    IN_APP_POLICY_OPTIONS,
    notificationPolicyColumns,
    POLICY_MEMBERS_CHOOSE,
  } from "$lib/settings/catalog-columns.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  let policy = $state<FirmNotificationPolicy | null>(null);
  let readFailure = $state<Failure | null>(null);
  let writeFailure = $state<StatedFailure | null>(null);
  let pending = $state<string[]>([]);

  const canEdit = $derived(sessionPermissions.holds(MANAGE_NOTIFICATION_POLICY_PERMISSION));

  async function load(): Promise<void> {
    readFailure = null;
    const outcome = await readFirmNotificationPolicy(fetch);
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    policy = outcome.value;
  }

  $effect(() => {
    void load();
    void sessionPermissions.load(fetch);
  });

  async function apply(key: string, patch: FirmNotificationPolicyPatch, subject: string) {
    if (pending.includes(key)) return;
    writeFailure = null;
    pending = [...pending, key];
    const outcome = await updateFirmNotificationPolicy(fetch, patch, crypto.randomUUID());
    pending = pending.filter((entry) => entry !== key);
    if (outcome.kind === "ok") {
      policy = outcome.value;
      return;
    }
    writeFailure = stated(
      outcome.failure,
      `${subject} was not changed.`,
      "Couldn't connect. Nothing changed. Try again.",
    );
  }

  function setCategory(
    category: NotificationCategory,
    change: { inApp?: NotificationInAppChoice | null; email?: NotificationEmailCadence | null },
  ): void {
    void apply(
      category,
      { categories: { [category]: change } },
      notificationCategoryLabel(category),
    );
  }

  function inAppFromValue(value: string): NotificationInAppChoice | null {
    return value === "on" || value === "off" ? value : null;
  }

  function emailFromValue(value: string): NotificationEmailCadence | null {
    return value === "off" || value === "daily" || value === "weekly" ? value : null;
  }

  const rows = $derived(policy?.categories ?? []);

  const grid = DataTable.createDataTableGrid<FirmCategoryPolicy>({
    columns: () => notificationPolicyColumns(),
    rows: () => rows,
    rowKey: (row) => row.category,
    itemNoun: { singular: "category", plural: "categories" },
  });

  // ---- the two scalars ---------------------------------------------------------------------------

  const RETENTION_DEFINITION: SettingDefinition = {
    id: "notification-policy.retention-days",
    sectionId: "notification-policy",
    plateLabel: "The Feed And The Mail",
    label: "How Long Notifications Are Kept",
    description: "How long every member's notifications stay in their feed before they age out.",
    kind: "number",
    minimum: MIN_RETENTION_DAYS,
    maximum: MAX_RETENTION_DAYS,
    unit: "day",
    defaultValue: MIN_RETENTION_DAYS,
    sensitivity: "open",
  };

  const DIGEST_HOUR_DEFINITION: SettingDefinition = {
    id: "notification-policy.digest-local-hour",
    sectionId: "notification-policy",
    plateLabel: "The Feed And The Mail",
    label: "When The Summary Arrives",
    description: "The hour of the firm's own day that the daily and weekly summaries are sent.",
    kind: "number",
    minimum: MIN_DIGEST_LOCAL_HOUR,
    maximum: MAX_DIGEST_LOCAL_HOUR,
    unit: "hour",
    defaultValue: MIN_DIGEST_LOCAL_HOUR,
    sensitivity: "open",
  };

  let retentionText = $state("");
  let hourText = $state("");
  // Seeded from the read, and re-seeded whenever the server answers — never while somebody types.
  $effect(() => {
    if (policy === null) return;
    retentionText = String(policy.retentionDays);
    hourText = String(policy.digestLocalHour);
  });

  function wholeNumberIn(text: string, low: number, high: number): number | null {
    const trimmed = text.trim();
    if (!/^\d{1,4}$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return parsed >= low && parsed <= high ? parsed : null;
  }

  const retentionRefusal = $derived(
    wholeNumberIn(retentionText, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS) === null
      ? `A whole number of days from ${MIN_RETENTION_DAYS} to ${MAX_RETENTION_DAYS}.`
      : undefined,
  );
  const hourRefusal = $derived(
    wholeNumberIn(hourText, MIN_DIGEST_LOCAL_HOUR, MAX_DIGEST_LOCAL_HOUR) === null
      ? `An hour of the day from ${MIN_DIGEST_LOCAL_HOUR} to ${MAX_DIGEST_LOCAL_HOUR}.`
      : undefined,
  );

  function commitRetention(): void {
    const retentionDays = wholeNumberIn(retentionText, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
    if (retentionDays === null || retentionDays === policy?.retentionDays) return;
    void apply("retention", { retentionDays }, "The retention window");
  }

  function commitHour(): void {
    const digestLocalHour = wholeNumberIn(hourText, MIN_DIGEST_LOCAL_HOUR, MAX_DIGEST_LOCAL_HOUR);
    if (digestLocalHour === null || digestLocalHour === policy?.digestLocalHour) return;
    void apply("hour", { digestLocalHour }, "The summary hour");
  }
</script>

<svelte:head>
  <title>Notification Policy · Settings · Magna Carta</title>
</svelte:head>

{#snippet policyCell({ row, column, text }: DataTable.GridCellContext<FirmCategoryPolicy>)}
  {#if column.id === "inApp" && canEdit}
    <ChoicePicker
      options={IN_APP_POLICY_OPTIONS}
      label="{notificationCategoryLabel(row.category)} in app"
      disabled={pending.includes(row.category)}
      bind:value={
        () => row.inApp ?? POLICY_MEMBERS_CHOOSE,
        (next) =>
          setCategory(row.category, {
            inApp: next === POLICY_MEMBERS_CHOOSE ? null : inAppFromValue(next),
          })
      }
    />
  {:else if column.id === "email" && canEdit}
    <ChoicePicker
      options={EMAIL_POLICY_OPTIONS}
      label="{notificationCategoryLabel(row.category)} email"
      disabled={pending.includes(row.category)}
      bind:value={
        () => row.email ?? POLICY_MEMBERS_CHOOSE,
        (next) =>
          setCategory(row.category, {
            email: next === POLICY_MEMBERS_CHOOSE ? null : emailFromValue(next),
          })
      }
    />
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet categoryDetail(row: FirmCategoryPolicy)}
  <span class="text-xs text-text-muted">{notificationCategoryDescription(row.category)}</span>
{/snippet}

<SettingsMasthead
  sectionId="notification-policy"
  title="Notification Policy"
  posture={canEdit ? "instant" : "readOnly"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    What the firm insists its members hear, and what it merely suggests. Each member still sets
    their own preferences under My Settings.
  </SettingsDescription>

  {#if writeFailure !== null}
    <FailureNotice
      failure={writeFailure.failure}
      fallback={writeFailure.fallback}
      whenSilent={writeFailure.whenSilent}
    />
  {/if}

  <SettingsPlate heading="By Category">
    {#if grid.isFiltered}
      <div class="flex items-center justify-end gap-8 py-12">
        <DataTable.ClearFilters {grid} />
      </div>
    {/if}
    {#if readFailure !== null && policy === null}
      <FailureNotice
        failure={readFailure}
        title="The Policy Could Not Be Read"
        fallback="The firm's notification policy was not read."
        onRetry={() => void load()}
      />
    {:else}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="The Policy Was Not Re-read"
          fallback="What is shown was read and stands."
          onRetry={() => void load()}
        />
      {/if}
      <DataTable.Grid
        {grid}
        caption="The firm's notification policy, by category and channel"
        cell={policyCell}
        rowDetail={categoryDetail}
        loading={policy === null}
        placeholderCount={3}
      />
      <DataTable.GridFooter {grid} />
    {/if}
    <SettingsPlateNote>
      Trust and Security always reach every member in app, whatever this page says: a firm cannot
      be in a position where nobody was told.
    </SettingsPlateNote>
  </SettingsPlate>

  <SettingsPlate heading="The Feed And The Mail">
    <!-- Two instant scalars in the shared row anatomy: each commits on its own as the field is
         left, and its refusal reads under the field it refuses. -->
    <SettingsRow definition={RETENTION_DEFINITION}>
      {#snippet control()}
        <div class="flex flex-col items-end gap-4">
          <div class="flex items-center gap-8">
            <Input
              id="settings-{RETENTION_DEFINITION.id}"
              bind:value={retentionText}
              inputmode="numeric"
              class="tabular-nums"
              disabled={!canEdit || pending.includes("retention")}
              aria-label="How long notifications are kept, in days"
              onblur={commitRetention}
            />
            <span class="text-sm text-text-muted">days</span>
          </div>
          {#if retentionRefusal !== undefined}
            <p class="text-xs text-text-muted">{retentionRefusal}</p>
          {/if}
        </div>
      {/snippet}
    </SettingsRow>
    <SettingsRow definition={DIGEST_HOUR_DEFINITION}>
      {#snippet control()}
        <div class="flex flex-col items-end gap-4">
          <div class="flex items-center gap-8">
            <Input
              id="settings-{DIGEST_HOUR_DEFINITION.id}"
              bind:value={hourText}
              inputmode="numeric"
              class="tabular-nums"
              disabled={!canEdit || pending.includes("hour")}
              aria-label="The hour the summary is sent"
              onblur={commitHour}
            />
            <Badge variant="neutral">24-hour</Badge>
          </div>
          {#if hourRefusal !== undefined}
            <p class="text-xs text-text-muted">{hourRefusal}</p>
          {/if}
        </div>
      {/snippet}
    </SettingsRow>
  </SettingsPlate>
</SettingsScrollRegion>
