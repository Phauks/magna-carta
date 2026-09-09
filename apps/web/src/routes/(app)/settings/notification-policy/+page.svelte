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
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import * as Select from "@magna-carta/design-system/select";
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
    type FirmNotificationPolicy,
    type FirmNotificationPolicyPatch,
  } from "$lib/notifications/firm-policy-api.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";

  /*
   * The firm's in-app lever, said as what it DOES. "Off" is worded as the default it is rather than
   * as a prohibition, because a member may still raise it.
   */
  const IN_APP_OPTIONS = [
    { value: "", label: "Members choose" },
    { value: "on", label: "Everyone hears this" },
    { value: "off", label: "Off unless a member turns it on" },
  ] as const;

  /** Every one of these is a default a member's own choice overrides — never a ceiling. */
  const EMAIL_OPTIONS = [
    { value: "", label: "Members choose" },
    { value: "off", label: "No email by default" },
    { value: "daily", label: "Daily summary by default" },
    { value: "weekly", label: "Weekly summary by default" },
  ] as const;

  let policy = $state<FirmNotificationPolicy | null>(null);
  let readFailure = $state<Failure | null>(null);
  let reading = $state(false);
  let writeFailure = $state<StatedFailure | null>(null);
  let pending = $state<string[]>([]);

  const canEdit = $derived(sessionPermissions.holds(MANAGE_NOTIFICATION_POLICY_PERMISSION));

  async function load(): Promise<void> {
    readFailure = null;
    reading = true;
    const outcome = await readFirmNotificationPolicy(fetch);
    reading = false;
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
      "Nothing answered, so nothing changed; choosing again tries once more.",
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

  // ---- the two scalars ---------------------------------------------------------------------------

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

  const rows = $derived(policy?.categories ?? []);
  const FIXTURE = ["deadlines", "tasks", "billing"] as const;
</script>

<svelte:head>
  <title>Notification Policy · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="notification-policy"
  title="Notification Policy"
  posture={canEdit ? "instant" : "readOnly"}
  showHistory={false}
/>

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
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
      <LoadingRegion
        loading={policy === null}
        failed={readFailure !== null && policy === null}
        refreshing={reading && policy !== null}
        label="Reading the firm's notification policy"
        onRetry={() => void load()}
        class="flex flex-col"
      >
        {#snippet failure()}
          {#if readFailure !== null}
            <FailureNotice
              failure={readFailure}
              title="The Policy Could Not Be Read"
              fallback="The firm's notification policy was not read."
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
                  <DataTable.Cell>Members choose</DataTable.Cell>
                  <DataTable.Cell>Members choose</DataTable.Cell>
                </DataTable.Row>
              {/each}
            </DataTable.Body>
          </DataTable.Root>
        {/snippet}

        {#if rows.length > 0}
          <DataTable.Root>
            <DataTable.Caption class="sr-only">
              The firm's notification policy, by category and channel
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
                <DataTable.Row>
                  <DataTable.Cell>
                    <span class="flex flex-col gap-2">
                      <span class="font-medium">{notificationCategoryLabel(row.category)}</span>
                      <span class="text-xs text-text-muted">
                        {notificationCategoryDescription(row.category)}
                      </span>
                    </span>
                  </DataTable.Cell>
                  <DataTable.Cell>
                    {#if canEdit}
                      <Select.Root
                        type="single"
                        items={[...IN_APP_OPTIONS]}
                        value={row.inApp ?? ""}
                        allowDeselect={false}
                        disabled={pending.includes(row.category)}
                        onValueChange={(next) =>
                          setCategory(row.category, {
                            inApp: next === "" ? null : (next as NotificationInAppChoice),
                          })}
                      >
                        <Select.Trigger
                          class="w-full"
                          aria-label="{notificationCategoryLabel(row.category)} in app"
                        >
                          <Select.Value placeholder="Members choose" />
                        </Select.Trigger>
                        <Select.Content>
                          {#each IN_APP_OPTIONS as option (option.value)}
                            <Select.Item value={option.value} label={option.label} />
                          {/each}
                        </Select.Content>
                      </Select.Root>
                    {:else}
                      <span class="text-sm">
                        {IN_APP_OPTIONS.find((option) => option.value === (row.inApp ?? ""))?.label}
                      </span>
                    {/if}
                  </DataTable.Cell>
                  <DataTable.Cell>
                    {#if canEdit}
                      <Select.Root
                        type="single"
                        items={[...EMAIL_OPTIONS]}
                        value={row.email ?? ""}
                        allowDeselect={false}
                        disabled={pending.includes(row.category)}
                        onValueChange={(next) =>
                          setCategory(row.category, {
                            email: next === "" ? null : (next as NotificationEmailCadence),
                          })}
                      >
                        <Select.Trigger
                          class="w-full"
                          aria-label="{notificationCategoryLabel(row.category)} email"
                        >
                          <Select.Value placeholder="Members choose" />
                        </Select.Trigger>
                        <Select.Content>
                          {#each EMAIL_OPTIONS as option (option.value)}
                            <Select.Item value={option.value} label={option.label} />
                          {/each}
                        </Select.Content>
                      </Select.Root>
                    {:else}
                      <span class="text-sm">
                        {EMAIL_OPTIONS.find((option) => option.value === (row.email ?? ""))?.label}
                      </span>
                    {/if}
                  </DataTable.Cell>
                </DataTable.Row>
              {/each}
            </DataTable.Body>
          </DataTable.Root>
          <p class="py-8 text-xs text-text-muted">
            Trust and Security always reach every member in app, whatever this page says: a firm
            cannot be in a position where nobody was told.
          </p>
        {/if}
      </LoadingRegion>
    </SettingsPlate>

    <SettingsPlate heading="The Feed And The Mail">
      <div class="flex items-start justify-between gap-16 py-12">
        <div class="flex min-w-0 grow flex-col gap-4">
          <span class="text-md">How Long Notifications Are Kept</span>
          <p class="text-sm text-text-muted">
            How long every member's notifications stay in their feed before they age out.
          </p>
          {#if retentionRefusal !== undefined}
            <p class="text-xs text-text-muted">{retentionRefusal}</p>
          {/if}
        </div>
        <div class="flex shrink-0 items-center gap-8" style="inline-size: var(--mc-size-popover)">
          <Input
            bind:value={retentionText}
            inputmode="numeric"
            disabled={!canEdit || pending.includes("retention")}
            aria-label="How long notifications are kept, in days"
            onblur={commitRetention}
          />
          <span class="text-sm text-text-muted">days</span>
        </div>
      </div>

      <div class="flex items-start justify-between gap-16 border-t border-border-subtle py-12">
        <div class="flex min-w-0 grow flex-col gap-4">
          <span class="text-md">When The Summary Arrives</span>
          <p class="text-sm text-text-muted">
            The hour of the firm's own day that the daily and weekly summaries are sent.
          </p>
          {#if hourRefusal !== undefined}
            <p class="text-xs text-text-muted">{hourRefusal}</p>
          {/if}
        </div>
        <div class="flex shrink-0 items-center gap-8" style="inline-size: var(--mc-size-popover)">
          <Input
            bind:value={hourText}
            inputmode="numeric"
            disabled={!canEdit || pending.includes("hour")}
            aria-label="The hour the summary is sent"
            onblur={commitHour}
          />
          <Badge variant="neutral">24-hour</Badge>
        </div>
      </div>
    </SettingsPlate>
  </div>
</div>
