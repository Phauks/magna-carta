<script lang="ts">
  /*
   * Settings · Beta Access — whether the firm runs the shipped build or the one ahead of it, under
   * the Platform band.
   *
   * LIVE, and it needed no new endpoint. The channel was always in the session bootstrap (every
   * session resolves it to evaluate the feature flags it carries) and the write has existed behind
   * `firm:manageReleaseChannel` since release channels landed — the page was a pair of seams over a
   * working subsystem. What it renders now is one decision rather than the two rows it used to
   * show: "release channel" and "participate in the beta programme" were the same fact asked twice.
   *
   * INSTANT WITH A CONSENT, rather than the draft footer every other firm page uses, and the reason
   * is the consent itself. Entering beta requires an explicit acknowledgement that the firm accepts
   * pre-release behavior on live client data — the server refuses it otherwise — and the shared
   * footer's recap is a generic list of staged changes, which is exactly not that. So the one act
   * that needs saying carries its own dialog saying it, and stepping back to stable is immediate,
   * because the server asks nothing to go back and neither should the screen.
   *
   * THE SWITCH SHOWS THE FIRM, NEVER THE PRESS. It is driven from the session's channel through a
   * getter/setter binding (release-channel-switch.ts): pressing it asks — the consent dialog on
   * the way in, the write on the way out — and the switch reads the channel, which moves only when
   * the server has agreed and the session has been re-read. So cancelling the consent leaves the
   * switch off, because nothing it reads has changed. Driven one-way (`checked={onBeta}`), the
   * design system's Switch kept its own copy, flipped itself on the press, and stayed on after a
   * cancel while the firm was still on the released build — the screen saying one thing and the
   * firm another.
   *
   * A FIRM ON ALPHA IS TOLD AND OFFERED NOTHING. Alpha is a platform channel a firm can neither
   * enter nor leave from inside the product; the write's vocabulary is the narrower {stable, beta}.
   * Rendering a control that would answer 422 for a reason the firm cannot act on would be worse
   * than stating where they are.
   *
   * THE CHANNEL IS RE-READ FROM THE SESSION after a change, not taken from the write's answer: what
   * actually changes the product is the flag set the new channel resolves to, and that arrives with
   * the next bootstrap.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Switch from "@magna-carta/design-system/switch";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import {
    MANAGE_RELEASE_CHANNEL_PERMISSION,
    setReleaseChannel,
  } from "$lib/settings/release-channel-api.ts";
  import {
    BETA_BRANCH_PLATE_HEADING,
    releaseChannelSwitchChecked,
    releaseChannelSwitchRequest,
  } from "$lib/settings/release-channel-switch.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  const CHANNEL_DEFINITION: SettingDefinition = {
    id: "beta-access.release-channel",
    sectionId: "beta-access",
    label: "Beta Programme",
    description:
      "Run the build ahead of the shipped one, so the firm sees new work before it is released.",
    kind: "switch",
    defaultValue: false,
    sensitivity: "open",
    audited: true,
  };

  const channel = $derived(sessionPermissions.session?.channel ?? null);
  const canEdit = $derived(sessionPermissions.holds(MANAGE_RELEASE_CHANNEL_PERMISSION));
  const onAlpha = $derived(channel === "alpha");
  const onBeta = $derived(releaseChannelSwitchChecked(channel));

  let consentOpen = $state(false);
  let moving = $state(false);
  let failure = $state<StatedFailure | null>(null);

  $effect(() => {
    void sessionPermissions.load(fetch);
  });

  /** Re-reads the session, because the flag set the new channel resolves to is what changed. */
  async function rereadSession(): Promise<void> {
    await sessionPermissions.reread(fetch);
  }

  async function move(next: "stable" | "beta"): Promise<boolean> {
    failure = null;
    moving = true;
    const outcome = await setReleaseChannel(fetch, next, crypto.randomUUID());
    if (outcome.kind === "ok") {
      await rereadSession();
      moving = false;
      return true;
    }
    moving = false;
    failure = stated(
      outcome.failure,
      next === "beta"
        ? "The firm was not moved to the beta programme."
        : "The firm was not moved back to the released build.",
      "Couldn't connect. The release channel is unchanged. You can safely try again.",
    );
    return false;
  }

  /** The switch's setter: it asks, and never moves the switch itself. */
  function requested(next: boolean): void {
    switch (releaseChannelSwitchRequest(next)) {
      case "ask-consent":
        consentOpen = true;
        return;
      case "leave":
        void move("stable");
        return;
    }
  }

  async function confirmJoin(): Promise<ActionOutcome> {
    return (await move("beta")) ? "committed" : "refused";
  }
</script>

<svelte:head>
  <title>Beta Access · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="beta-access"
  title="Beta Access"
  posture={canEdit && !onAlpha ? "instant" : "readOnly"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    Whether this firm runs the released build or the one ahead of it.
  </SettingsDescription>

  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
    />
  {/if}

  <SettingsPlate heading={BETA_BRANCH_PLATE_HEADING}>
    <LoadingRegion
      loading={channel === null && !sessionPermissions.settled}
      failed={sessionPermissions.settled && channel === null}
      label="Reading the firm's release channel"
      onRetry={() => void rereadSession()}
      class="flex flex-col divide-y divide-border-default"
    >
      {#snippet failure()}
        <SettingsPlateNote>
          The firm's release channel could not be read, so it is not shown rather than guessed at.
        </SettingsPlateNote>
      {/snippet}
      {#snippet fixture()}
        <SettingsRow definition={CHANNEL_DEFINITION} value={false} />
      {/snippet}

      {#if onAlpha}
        <!-- Stated rather than controlled: a firm cannot enter or leave alpha from here, so a
             switch would be a control whose only outcome is a refusal. -->
        <SettingsRow definition={CHANNEL_DEFINITION}>
          {#snippet control()}
            <Badge variant="info">Alpha</Badge>
          {/snippet}
        </SettingsRow>
        <SettingsPlateNote>
          This firm is on the alpha channel, which is set by the platform rather than from here.
        </SettingsPlateNote>
      {:else if canEdit}
        <SettingsRow definition={CHANNEL_DEFINITION}>
          {#snippet control()}
            {#if onBeta}
              <Badge variant="info">Beta</Badge>
            {/if}
            <!-- Function-form binding: the switch always re-reads the channel, and the setter only
                 asks. A cancelled consent therefore leaves it exactly where the firm is. -->
            <Switch
              bind:checked={() => onBeta, requested}
              disabled={moving}
              aria-label="Participate in the beta programme"
            />
          {/snippet}
        </SettingsRow>
      {:else}
        <SettingsRow definition={CHANNEL_DEFINITION} value={onBeta} />
      {/if}
    </LoadingRegion>
  </SettingsPlate>
</SettingsScrollRegion>

<ActionDialog
  bind:open={consentOpen}
  kind="confirm"
  heading="Join the Beta Programme"
  commitLabel="Join the Beta Programme"
  commitBusyLabel="Joining"
  unsavedChanges={false}
  onCommit={confirmJoin}
>
  {#snippet fields()}
    <div class="flex flex-col gap-12 text-sm">
      <p>
        Beta builds carry work that has passed our own review and has not yet been released. They
        run against the firm's real matters, real client money and real documents, not a copy.
      </p>
      <p>
        The firm can step back to the released build at any time, from this page, without asking
        anybody. What a beta build has already recorded stays recorded.
      </p>
      <p class="text-text-muted">
        Joining is recorded in the firm's audit log against the member who joined.
      </p>
    </div>
  {/snippet}
</ActionDialog>
