<script lang="ts">
  /*
   * Settings · Notifications — what this member hears about, and how.
   *
   * ONE ROW PER CATEGORY, TWO CONTROLS ON IT. A member decides "deadlines: yes, and mail me daily"
   * in one thought, so the two channels sit on one row rather than in two plates twelve rows apart.
   * The grain is the CATEGORY and never the individual kind: the platform registers dozens of kinds,
   * and a member asked to set dozens of switches sets none of them.
   *
   * THE TWO TIERS COMPOSE IN OPPOSITE DIRECTIONS, AND THE SCREEN HAS TO SAY SO. In the application
   * the firm's setting is a FLOOR — a firm may require a category and a member may not lower it. By
   * email the MEMBER's choice wins outright, because a firm cannot make somebody's mailbox carry
   * more than they asked for. A screen that showed twelve identical switch pairs would be lying
   * about the second half of that, so a switch the member cannot move is disabled with the reason
   * stated beside it, in words, rather than greyed out with a lock glyph.
   *
   * WHAT IT HAS ALREADY STOPPED IS SHOWN. Turning a category off writes no notification at all, and
   * afterwards "nobody told me" and "I asked not to be told" are indistinguishable — which is how a
   * member loses confidence in the feed and how a genuine fault hides. The platform counts every
   * suppression, so this screen reports the count beside the switch that caused it.
   *
   * INSTANT POSTURE, AND THE SERVER'S ANSWER IS THE ONE ON SCREEN. Every change is a sparse PATCH
   * that returns the whole re-resolved matrix, and the response replaces local state wholesale. A
   * setting the firm's floor overrode is therefore visibly overridden a moment later rather than
   * appearing to have taken — the row is never left showing what the member pressed instead of what
   * the platform will do.
   */
  import Badge from "@magna-carta/design-system/badge";
  import * as Select from "@magna-carta/design-system/select";
  import Switch from "@magna-carta/design-system/switch";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import { CATEGORY_PRESENTATION } from "$lib/notifications/notification-presentation.ts";
  import {
    NOTIFICATION_CATEGORIES,
    readNotificationPreferences,
    updateNotificationPreferences,
    type NotificationCategory,
    type NotificationEmailCadence,
    type NotificationPreferences,
    type ResolvedCategoryPreference,
  } from "$lib/notifications/notifications-api.ts";
  import type { Failure } from "$lib/api/request.ts";
  import { formatDate } from "@magna-carta/design-system/formatters";

  let preferences = $state<NotificationPreferences | null>(null);
  let readFailure = $state<Failure | null>(null);
  /** Which category is mid-write, so its two controls hold still until the server answers. */
  let saving = $state<NotificationCategory | null>(null);
  let reloadToken = $state(0);

  $effect(() => {
    void reloadToken;
    void (async () => {
      const outcome = await readNotificationPreferences(fetch);
      if (outcome.kind === "ok") {
        preferences = outcome.value;
        readFailure = null;
        return;
      }
      readFailure = outcome.failure;
    })();
  });

  const byCategory = $derived(
    new Map((preferences?.categories ?? []).map((entry) => [entry.category, entry])),
  );

  /**
   * How many notifications this member's OWN choice has stopped, inside the firm's retention window.
   * The firm-policy half of the tally is deliberately not shown here: this page is the member's own
   * levers, and a count they cannot act on reads as a reproach rather than as information.
   */
  const suppressedByOwnChoice = $derived(
    new Map(
      (preferences?.suppressedInApp ?? [])
        .filter((tally) => tally.reason === "member-preference")
        .map((tally) => [tally.category, tally.count]),
    ),
  );

  /**
   * The near edge of the firm's retention window — what the suppression tallies count from. Derived
   * rather than read inside the row snippet: a snippet is a closure, so the template's own
   * null-narrowing does not reach into it.
   */
  const countingSince = $derived(preferences?.suppressedSinceCivilDate ?? null);

  const EMAIL_CADENCE_OPTIONS: { value: NotificationEmailCadence; label: string }[] = [
    { value: "off", label: "No email" },
    { value: "daily", label: "Daily summary" },
    { value: "weekly", label: "Weekly summary" },
  ];

  function definitionFor(category: NotificationCategory): SettingDefinition {
    const presentation = CATEGORY_PRESENTATION[category];
    return {
      id: `notifications.${category}`,
      sectionId: "notifications",
      label: presentation.label,
      description: presentation.description,
      // The row's own control is bespoke — two channels on one row — so the kind names the shape of
      // the primary one and the `control` snippet supplies the pair.
      kind: "switch",
      defaultValue: true,
      sensitivity: "open",
    };
  }

  async function patch(
    category: NotificationCategory,
    change: { inApp?: "on" | "off"; email?: NotificationEmailCadence },
  ): Promise<void> {
    saving = category;
    const outcome = await updateNotificationPreferences(fetch, { [category]: change });
    saving = null;
    // The response IS the matrix — it carries what the firm's floor did to the request, so it
    // replaces state rather than being merged into it.
    if (outcome.kind === "ok") {
      preferences = outcome.value;
      readFailure = null;
      return;
    }
    readFailure = outcome.failure;
  }

  /** Why a switch will not move, in words the member can act on. Null where they are free. */
  function lockReason(entry: ResolvedCategoryPreference): string | null {
    if (entry.inAppLockedBy === "mandatory") return "Always shown";
    if (entry.inAppLockedBy === "firm-policy") return "Required by your firm";
    return null;
  }
</script>

<svelte:head>
  <title>Notifications · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead sectionId="notifications" title="Notifications" posture="instant" />

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsDescription>
      What reaches you, and how. In the application these are yours except where your firm requires a
      category; by email the choice is always yours — a firm can lower what it sends you, never raise
      it.
    </SettingsDescription>

    <LoadingRegion
      loading={preferences === null && readFailure === null}
      failed={preferences === null && readFailure !== null}
      label="Reading your notification settings"
      onRetry={() => (reloadToken += 1)}
      class="flex flex-col gap-16"
    >
      {#snippet failure()}
        {#if readFailure !== null}
          <FailureNotice
            failure={readFailure}
            title="Settings Unavailable"
            fallback="Your notification settings could not be read."
            onRetry={() => (reloadToken += 1)}
          />
        {/if}
      {/snippet}

      {#if preferences !== null}
        <!-- A write that failed while the matrix is already on screen. The rows keep the last
             answer the server gave rather than the one the member pressed, so nothing on screen
             claims a setting took when it did not. -->
        {#if readFailure !== null}
          <FailureNotice
            failure={readFailure}
            title="Change Not Saved"
            fallback="That change could not be saved. The settings below are unchanged."
            onRetry={() => (reloadToken += 1)}
          />
        {/if}

        <SettingsPlate heading="Categories">
          {#each NOTIFICATION_CATEGORIES as category (category)}
            {@const entry = byCategory.get(category)}
            {#if entry !== undefined}
              {@const locked = lockReason(entry)}
              {@const stopped = suppressedByOwnChoice.get(category) ?? 0}
              <SettingsRow definition={definitionFor(category)}>
                {#snippet control()}
                  <div class="flex flex-col items-end gap-8">
                    <div class="flex items-center gap-12">
                      {#if locked !== null}
                        <Badge variant="neutral">{locked}</Badge>
                      {/if}
                      <label class="flex items-center gap-8 text-xs text-text-muted">
                        In app
                        <Switch
                          checked={entry.inApp === "on"}
                          disabled={locked !== null || saving === category}
                          aria-label="{CATEGORY_PRESENTATION[category].label} in the application"
                          onCheckedChange={(next) =>
                            void patch(category, { inApp: next ? "on" : "off" })}
                        />
                      </label>
                    </div>

                    <Select.Root
                      type="single"
                      items={EMAIL_CADENCE_OPTIONS}
                      value={entry.email}
                      disabled={saving === category}
                      onValueChange={(value) =>
                        void patch(category, { email: value as NotificationEmailCadence })}
                    >
                      <Select.Trigger
                        class="w-44"
                        aria-label="{CATEGORY_PRESENTATION[category].label} by email"
                      >
                        <Select.Value placeholder="No email" />
                      </Select.Trigger>
                      <Select.Content>
                        {#each EMAIL_CADENCE_OPTIONS as option (option.value)}
                          <Select.Item value={option.value} label={option.label} />
                        {/each}
                      </Select.Content>
                    </Select.Root>

                    {#if stopped > 0 && countingSince !== null}
                      <!-- A suppressed notification is a counted fact, never an absence. -->
                      <p class="text-xs text-text-subtle">
                        {stopped}
                        {stopped === 1 ? "notification" : "notifications"} not shown since
                        {formatDate(countingSince)}
                      </p>
                    {/if}
                  </div>
                {/snippet}
              </SettingsRow>
            {/if}
          {/each}
        </SettingsPlate>

        <p class="text-xs text-text-muted">
          Summary emails carry counts only — how many items are waiting, in which categories, and a
          link. They never carry a matter name or number, a filename, a subject line, a date or an
          amount, because a mailbox is outside the platform and cannot be re-checked once mail has
          left.
        </p>
      {/if}
    </LoadingRegion>
  </div>
</div>
