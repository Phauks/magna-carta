<script lang="ts">
  /*
   * Meeting encryption: the room's header mark, the pause banner and the Security tab, and Start's
   * End-to-end encrypted switch, over fixtures.
   *
   * No deployment opens a meeting encrypted yet (MEETINGS_END_TO_END_ENCRYPTION stays off), so no
   * real meeting reaches any of these states. They are the real components: the room's pieces are
   * composed here the way meeting-room-screen.svelte composes them, from an `EncryptionState`, code
   * groups and members of the shape the client exposes; and the calendar entry's control is the
   * real one, over a session that says the deployment encrypts and, for Join, a running meeting
   * seeded into the query cache. Pick a state with the control at the top.
   *
   * Dev builds only, like the developer console itself, behind the import.meta.env.DEV gate.
   */
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { meetingsGetForEventQueryKey, type MeetingSummary } from "@magna-carta/api-client";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import * as Card from "@magna-carta/design-system/card";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import { queryClient } from "$lib/api/screen-data.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import MeetingEntryAction from "$lib/meetings/meeting-entry-action.svelte";
  import MeetingGrid from "$lib/meetings/screen/meeting-grid.svelte";
  import MeetingControls from "$lib/meetings/screen/meeting-controls.svelte";
  import MeetingRoster from "$lib/meetings/screen/meeting-roster.svelte";
  import MeetingSidePanel, {
    type MeetingSideTab,
  } from "$lib/meetings/screen/meeting-side-panel.svelte";
  import MeetingSecurityPanel from "$lib/meetings/screen/meeting-security-panel.svelte";
  import EncryptionMark from "$lib/meetings/screen/encryption-mark.svelte";
  import EncryptionPauseNotice from "$lib/meetings/screen/encryption-pause-notice.svelte";
  import RecordingMark from "$lib/meetings/screen/recording-mark.svelte";
  import {
    securityCodeGroups,
    type EncryptionState,
    type KeyGroupMember,
  } from "$lib/meetings/client/encryption-status.ts";
  import { DEFAULT_EFFECT_SETTINGS } from "$lib/meetings/client/media-effects.ts";
  import type { MeetingParticipant } from "$lib/meetings/client/meeting-client.svelte.ts";
  import type { MeetingTileModel } from "$lib/meetings/screen/meeting-tiles.ts";

  type GalleryState = "on" | "paused" | "both" | "connecting" | "failed";
  const STATES: readonly GalleryState[] = ["on", "paused", "both", "connecting", "failed"];

  const chosen = $derived.by((): GalleryState => {
    const asked = page.url.searchParams.get("state");
    return STATES.find((one) => one === asked) ?? "paused";
  });

  const encryption = $derived.by((): EncryptionState => {
    switch (chosen) {
      case "on":
        return { kind: "on" };
      case "paused":
        return { kind: "paused", reasons: ["recording"] };
      case "both":
        return { kind: "paused", reasons: ["recording", "captions"] };
      case "connecting":
        return { kind: "connecting" };
      case "failed":
        return { kind: "failed" };
    }
  });
  const inGroup = $derived(encryption.kind === "on" || encryption.kind === "paused");

  function show(next: string): void {
    const url = new URL(page.url);
    url.searchParams.set("state", next);
    void goto(url, { replace: true, reset: false });
  }

  const PEOPLE = [
    { participantId: "attendance_1", name: "Avery Grant", kind: "member" },
    { participantId: "attendance_2", name: "Jordan Ellis", kind: "guest" },
    { participantId: "attendance_3", name: "Priya Natarajan", kind: "member" },
    { participantId: "attendance_4", name: "Trevor Gale", kind: "member" },
  ] as const;
  const OWN = "attendance_4";

  const participants: readonly MeetingParticipant[] = PEOPLE.map((person, index) => ({
    participantId: person.participantId,
    userId: `user_${index + 1}`,
    displayName: person.name,
    accountName: null,
    sfuSessionId: `session_${index + 1}`,
    tracks: [{ trackName: `${person.participantId}:audio`, kind: "audio" }],
    speaking: false,
    muted: false,
    hand: false,
    handRaisedAt: null,
    hostRole: index === 0 ? "host" : null,
    kind: person.kind,
  }));

  const tiles: readonly MeetingTileModel[] = PEOPLE.map((person, index) => ({
    key: person.participantId,
    participantId: person.participantId,
    userId: person.kind === "guest" ? null : `user_${index + 1}`,
    name: person.participantId === OWN ? `${person.name} (You)` : person.name,
    hostRole: index === 0 ? "host" : null,
    spotlighted: false,
    stream: null,
    local: person.participantId === OWN,
    microphoneOff: false,
    speaking: index === 0,
    handRaised: false,
    reactions: [],
    pinned: false,
    videoPulled: false,
    quality: "good",
  })) as unknown as readonly MeetingTileModel[];

  const members: readonly KeyGroupMember[] = PEOPLE.map((person) => ({
    participantId: person.participantId,
    displayName: person.name,
    self: person.participantId === OWN,
  }));

  const codeGroups = securityCodeGroups("48213 90577 13066 72458 35910 64102");

  let tab = $state<MeetingSideTab>("security");

  /*
   * THE ENTRY'S TWO STATES. The session says this deployment encrypts and that the reader may host;
   * the first entry has no meeting (its read is refused here, which the control takes as none), and
   * the second has an encrypted meeting running, seeded into the cache under the real query's key.
   */
  sessionPermissions.session = {
    user: { id: "user_4", name: "Trevor Gale", email: "trevor@example.test" },
    firm: { id: "firm_gallery", name: "Gallery Firm" },
    permissions: ["meetings:host", "meetings:join"],
    channel: "stable",
    flags: {},
    meetings: { endToEndEncryption: true },
  };
  sessionPermissions.settled = true;

  const RUNNING_EVENT = "matterEvent_galleryRunning";
  const running: MeetingSummary = {
    id: "meeting_gallery",
    eventKind: "matter",
    eventId: RUNNING_EVENT,
    matterId: "matter_gallery",
    matterTitle: "Okafor v. Lindqvist Freight",
    joinCode: "123456789",
    title: "Settlement Conference",
    startsOn: "2026-11-19",
    startsAtTime: "14:00",
    endsAtTime: "15:00",
    timeZone: "America/New_York",
    status: "live",
    startedAt: "2026-11-19T19:00:00.000Z",
    endedAt: null,
    medium: "video",
    liveCount: 3,
    locked: false,
    lobby: "off",
    configured: true,
    recordingState: "none",
    recordingConfigured: true,
    captionsAvailable: true,
    personalRoomSession: false,
    encrypted: true,
  };
  queryClient.setQueryData(
    meetingsGetForEventQueryKey({ path: { eventId: RUNNING_EVENT } }),
    running,
  );
</script>

{#snippet emptyTab()}
  <p class="text-sm text-text-muted">Drawn in the room.</p>
{/snippet}

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-24 bg-surface-default p-16 text-text-default sm:p-24">
    <div class="flex flex-wrap items-center gap-12">
      <span id="gallery-state-label" class="sr-only">Encryption state</span>
      <SegmentedControl.Root
        aria-labelledby="gallery-state-label"
        value={chosen}
        onValueChange={(next) => show(next)}
      >
        <SegmentedControl.Item value="on">On</SegmentedControl.Item>
        <SegmentedControl.Item value="paused">Paused</SegmentedControl.Item>
        <SegmentedControl.Item value="both">Two Reasons</SegmentedControl.Item>
        <SegmentedControl.Item value="connecting">Connecting</SegmentedControl.Item>
        <SegmentedControl.Item value="failed">Failed</SegmentedControl.Item>
      </SegmentedControl.Root>
    </div>

    <section class="flex min-h-0 flex-col gap-16" data-gallery-room="">
      <ScreenHeader
        title="Settlement Conference: Okafor v. Lindqvist Freight"
        favoritable={false}
        back={DEVELOPER_CONSOLE_BACK}
      >
        {#snippet meta()}
          <span>Thursday, November 19, 2026</span>
          <span>2:00 PM to 3:00 PM EST</span>
          <span>Matter</span>
          {#if encryption.kind === "paused"}
            <RecordingMark />
          {/if}
          <EncryptionMark {encryption} />
          <span>4 in the room</span>
        {/snippet}
      </ScreenHeader>

      <EncryptionPauseNotice {encryption} />

      <div class="flex h-screen min-h-0 flex-col gap-16">
        <div class="flex min-h-0 flex-1 gap-16">
          <div class="min-h-0 min-w-0 flex-1">
            <MeetingGrid {tiles} roomSize={tiles.length} />
          </div>
          <div class="min-h-0 w-xs shrink-0 lg:w-sm">
            <MeetingSidePanel
              bind:tab
              peopleCount={participants.length}
              onClose={() => {}}
              chat={emptyTab}
              polls={emptyTab}
              securityPaused={encryption.kind === "paused"}
            >
              {#snippet people()}
                <MeetingRoster {participants} ownParticipantId={OWN} />
              {/snippet}
              {#snippet security()}
                <MeetingSecurityPanel
                  {encryption}
                  codeGroups={inGroup ? codeGroups : []}
                  members={inGroup ? members : []}
                  isGuest={(participantId) => participantId === "attendance_2"}
                />
              {/snippet}
            </MeetingSidePanel>
          </div>
        </div>
        <MeetingControls
          microphoneOn={true}
          cameraOn={true}
          sharing={false}
          effectSettings={DEFAULT_EFFECT_SETTINGS}
          recording={encryption.kind === "paused"}
          mayStopRecording={true}
          sideTab={tab}
          peopleCount={participants.length}
          onToggleMicrophone={() => {}}
          onToggleCamera={() => {}}
          onToggleSharing={() => {}}
          onToggleHand={() => {}}
          onLeave={() => {}}
        />
      </div>
    </section>

    <section class="grid gap-16 md:grid-cols-2" data-gallery-entry="">
      <Card.Root>
        <Card.Header>
          <Card.Title>Start</Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-wrap items-center gap-8">
          <MeetingEntryAction eventKind="matter" eventId="matterEvent_galleryNew" />
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Header>
          <Card.Title>Once It Is Running</Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-wrap items-center gap-8">
          <MeetingEntryAction eventKind="matter" eventId={RUNNING_EVENT} />
        </Card.Content>
      </Card.Root>
    </section>
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">This page is only available in development builds.</p>
{/if}
