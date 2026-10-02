<script lang="ts">
  /*
   * A meeting, for somebody from outside the firm who was sent a link to it.
   *
   * IT IS THE ROOM AND NOTHING ELSE. This renders outside the application's shell, from the firm's
   * own origin, for a person who holds no session and never will: no sidebar, no navigation, no
   * search, no notifications, no way back into the application and no route that could produce one.
   * The one band of chrome says whose meeting this is, and everything under it is the meeting.
   *
   * THE ORDER OF ARRIVAL IS THE MEMBER'S, WITH A DOOR IN FRONT OF IT. Opening the link reads what
   * the meeting is and spends nothing. Pressing Join spends the link and opens a stay AT THE DOOR,
   * because a guest always waits for a host; the socket opens on the grant that answer carried, and
   * the room's own frames move the page from the door into the room. The room client, the tiles,
   * the controls and the waiting surface are the member's, unchanged: a person standing at a door is
   * a person standing at a door, and a second copy of that screen would be a second place to keep
   * its sentence right.
   *
   * LEAVING IS ITS OWN ACT, ON EVERY WAY OUT, for the reason the member's room gives: a socket that
   * closes is not somebody leaving, so the Leave control, leaving the page and closing the tab each
   * close the stay themselves.
   *
   * WHAT A GUEST NEVER HAS. No End, no host controls, no attendance, and no member identifier on the
   * roster. What a guest DOES have is the room's chat, on the same record terms every line has, over
   * the guest's own two routes — and no way to take a line back, which is a member's act.
   */
  import { onDestroy, onMount, untrack } from "svelte";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FailureBand from "@magna-carta/design-system/failure-band";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import * as TopBar from "@magna-carta/design-system/top-bar";
  import { formatDate, formatTimeZoneAbbreviation } from "@magna-carta/design-system/formatters";
  import { instantForCivilDateTime } from "@magna-carta/civil-time/time-zone";
  import { SAMPLE_SENTENCE, sampleMatter } from "@magna-carta/design-system/loading-fixtures";
  import AuthPanel from "$lib/auth/auth-panel.svelte";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { formatWallClock } from "$lib/calendar/calendar-api.ts";
  import {
    browserMeetingSeams,
    DENIED_REASON,
    MeetingClient,
    PROTOCOL_MISMATCH_REASON,
    refusalStatement,
    REMOVED_REASON,
    WITHDRAWN_REASON,
    SUPERSEDED_REASON,
    type MeetingClientSeams,
  } from "./client/meeting-client.svelte.ts";
  import {
    browserGuestDeviceSeams,
    withChosenDevices,
    type GuestDeviceChoice,
    type GuestDeviceSeams,
  } from "./client/guest-devices.ts";
  import {
    arriveAsGuest,
    guestChatSeams,
    guestMeetingSocketProtocols,
    guestMeetingSocketUrl,
    guestRefusalNamed,
    guestRefusalOf,
    leaveMeetingAsGuest,
    leaveMeetingAsGuestOnDeparture,
    openGuestMeetingSocket,
    readGuestMeeting,
    type GuestMeetingSummary,
    type GuestRefusal,
  } from "./guest-api.ts";
  import { MeetingChat } from "./client/chat.svelte.ts";
  import {
    meetingTiles,
    participantName,
    sharedScreenTile,
    speakerViewTile,
  } from "./screen/meeting-tiles.ts";
  import {
    connectionEvents,
    connectionParticipants,
    connectionUplink,
  } from "./screen/meeting-connection.ts";
  import GuestArrival from "./guest-arrival.svelte";
  import MeetingLobbyWait from "./meeting-lobby-wait.svelte";
  import MeetingAudio from "./screen/meeting-audio.svelte";
  import MeetingChatPanel from "./screen/meeting-chat-panel.svelte";
  import MeetingConnectionPanel from "./screen/meeting-connection-panel.svelte";
  import MeetingControls from "./screen/meeting-controls.svelte";
  import MeetingGrid from "./screen/meeting-grid.svelte";
  import MeetingReactionCounts from "./screen/meeting-reaction-counts.svelte";
  import MeetingReactions from "./screen/meeting-reactions.svelte";
  import MeetingRoster from "./screen/meeting-roster.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import type { MeetingMessage } from "@magna-carta/api-client";

  let {
    token,
    deviceSeams = browserGuestDeviceSeams(),
    clientSeams = browserMeetingSeams(),
    openSocket = openGuestMeetingSocket,
  }: {
    /** The link's token, read from the address. It never leaves this page except as a header. */
    token: string;
    /** The devices the check at the door reaches, as a seam so it runs under a test. */
    deviceSeams?: GuestDeviceSeams;
    /** The room client's own seams, all but the socket. */
    clientSeams?: MeetingClientSeams;
    /**
     * The guest's signaling socket, which offers the grant as its subprotocol. It replaces the room
     * client's own socket seam rather than wrapping it, because that one takes an address and
     * nothing else, and the address is exactly where the grant must not travel.
     */
    openSocket?: (url: string, protocols: readonly string[]) => WebSocket;
  } = $props();

  // ---- what the link opens onto --------------------------------------------------------------

  let summary = $state<GuestMeetingSummary | null>(null);
  let reading = $state(true);
  let readFailure = $state<Failure | null>(null);

  async function readSummary(): Promise<void> {
    reading = true;
    readFailure = null;
    const outcome = await readGuestMeeting(token);
    reading = false;
    if (outcome.kind === "ok") {
      summary = outcome.value;
      return;
    }
    readFailure = outcome.failure;
  }

  onMount(() => {
    void readSummary();
  });

  // ---- the devices chosen at the door, reaching the room's own capture -------------------------

  /*
   * Not reactive, and read at the moment of capture: the room asks for the microphone and camera
   * when a host admits this guest, which is long after the door, and it asks through its own seam.
   * Wrapping that one seam is what lets the room client stay exactly as a member's.
   */
  let chosenDevices: GuestDeviceChoice = { microphoneId: null, cameraId: null };

  /**
   * The grant the next socket offers. Not reactive, and read at the moment the socket opens, for
   * the reason the devices are: the room client asks for its socket through its own seam, and it is
   * set by the arrival immediately before the client is told to join.
   */
  let socketGrant = "";

  // The seams are read once, when the room client is built; the client is never rebuilt.
  const roomSeams: MeetingClientSeams = (() => {
    const given = untrack(() => clientSeams);
    const openGuestSocket = untrack(() => openSocket);
    return {
      ...given,
      getUserMedia: (constraints: MediaStreamConstraints) =>
        given.getUserMedia(withChosenDevices(constraints, chosenDevices)),
      openSocket: (url: string) => openGuestSocket(url, guestMeetingSocketProtocols(socketGrant)),
    };
  })();
  const client = new MeetingClient(roomSeams);

  // ---- arriving -------------------------------------------------------------------------------

  /** The name last given at the door, so a way back in does not ask for it twice. */
  let givenName = $state("");
  let arriving = $state(false);
  let arrivalFailure = $state<Failure | null>(null);
  /**
   * The grant for the stay this browser holds, or null while it holds none.
   *
   * IT IS THE STAY ITSELF, as far as this page is concerned: set by an arrival, cleared by every
   * way the stay ends, and read by every departure — so a departure sent twice is sent once.
   */
  let grant = $state<string | null>(null);
  /** The name the room knows this guest by, as the arrival answered it. */
  let displayName = $state("");
  /** True while a leave is in flight, so the way out cannot be taken twice. */
  let leaving = $state(false);
  /** This guest left on purpose, and the page says so rather than offering the door as if new. */
  let left = $state(false);
  /**
   * Whether the room client's last stay was closed by this guest's own Leave. Leaving closes the
   * client, which is the same state a room that ENDED leaves it in — and only one of the two means
   * the meeting is over. Kept until the next arrival opens a stay of its own.
   */
  let closedByLeaving = $state(false);

  async function arrive(confirmedName: string, devices: GuestDeviceChoice): Promise<void> {
    if (arriving || grant !== null) return;
    givenName = confirmedName;
    chosenDevices = devices;
    arriving = true;
    arrivalFailure = null;
    const outcome = await arriveAsGuest(token, confirmedName);
    arriving = false;
    if (outcome.kind !== "ok") {
      arrivalFailure = outcome.failure;
      return;
    }
    left = false;
    leaving = false;
    closedByLeaving = false;
    grant = outcome.value.guestGrant;
    socketGrant = outcome.value.guestGrant;
    displayName = outcome.value.displayName;
    client.join({
      // A guest holds no meeting identifier: the meeting is a fact of the grant, not of anything
      // this page addresses. The client only records the field, so it is left empty.
      meetingId: "",
      participantId: outcome.value.participantId,
      iceServers: outcome.value.iceServers,
      socketUrl: guestMeetingSocketUrl(),
      medium: outcome.value.medium,
      waiting: outcome.value.waiting,
    });
    // Asked for on every arrival: the client refuses it at the door and asks again itself the
    // moment a host admits this guest, which is the one place the camera rule is written.
    await client.publish();
  }

  /** Go back in after the connection went away: a fresh arrival on the same link and the same name. */
  function rejoin(): void {
    grant = null;
    void arrive(givenName, chosenDevices);
  }

  /** Back to the door after leaving on purpose. The link was not spent by leaving. */
  function returnToTheDoor(): void {
    left = false;
    arrivalFailure = null;
  }

  // ---- leaving --------------------------------------------------------------------------------

  async function leave(): Promise<void> {
    const held = grant;
    if (leaving || held === null) return;
    leaving = true;
    grant = null;
    closedByLeaving = true;
    client.leave();
    await leaveMeetingAsGuest(held);
    leaving = false;
    left = true;
  }

  /** The same act on the way out of the page, best effort: nothing can be awaited or shown. */
  function depart(): void {
    const held = grant;
    if (held === null) return;
    grant = null;
    client.dispose();
    void leaveMeetingAsGuest(held);
  }

  /*
   * Closing the tab, which `onDestroy` never sees. `pagehide` fires in every case and
   * `beforeunload` is the fallback where a browser gives only that; clearing the grant first is
   * what makes the second of the two a no-op.
   */
  function departOnUnload(): void {
    const held = grant;
    if (held === null) return;
    grant = null;
    client.dispose();
    leaveMeetingAsGuestOnDeparture(held);
  }

  onDestroy(() => {
    depart();
  });

  /*
   * Two ways the stay ends without this browser asking. The room ENDING closes every stay on the
   * server at one instant, so a leave afterwards would close a stay that is already closed. A
   * socket SUPERSEDED by a newer one on the same link is the dangerous one: the stay is open and is
   * now the other window's, and a leave from here would take the window that is in the room out of
   * it. Being turned away or taken out closes the stay too, on the host's act.
   */
  $effect(() => {
    const reason = client.failureReason;
    if (
      client.state === "ended" ||
      reason === SUPERSEDED_REASON ||
      reason === DENIED_REASON ||
      reason === REMOVED_REASON ||
      reason === WITHDRAWN_REASON
    ) {
      grant = null;
    }
  });

  // ---- what is said in writing -------------------------------------------------------------------

  /*
   * The transcript, over the grant this browser holds now: a guest who comes back in after a
   * dropped connection holds a fresh grant, and a chat that captured the first would be reading the
   * room on a credential that no longer works.
   */
  const chat = new MeetingChat(guestChatSeams(() => grant));
  client.relayMessagesTo(chat);
  let chatOpen = $state(false);
  let chatDraft = $state("");

  // Followed while this guest is IN the room and never at the door: a stay at the door may not
  // read the transcript, and the room has not let them hear it yet.
  $effect(() => {
    if (client.state !== "live") return;
    chat.start();
    return () => {
      chat.stop();
    };
  });

  $effect(() => {
    if (chatOpen) chat.noteOpened();
    else chat.noteClosed();
  });

  /** Who said something, by the name the roster carries. A guest's roster carries names alone. */
  function chatSenderName(message: MeetingMessage): string {
    const stay = client.participants.find((one) => one.participantId === message.participantId);
    return stay === undefined ? "Somebody who left" : participantName(stay);
  }

  // ---- what the screen is showing ---------------------------------------------------------------

  /** The link's own refusal, where the read or the arrival was refused because of the link. */
  const linkRefusal = $derived.by((): GuestRefusal | null => {
    if (readFailure !== null) return guestRefusalOf(readFailure);
    if (arrivalFailure !== null) {
      const refusal = guestRefusalOf(arrivalFailure);
      // A refusal worth trying again is said under the Join control that caused it, and the door
      // stays; one that is final replaces the door, because there is nothing left on it to press.
      return refusal !== null && !refusal.retryable ? refusal : null;
    }
    return null;
  });
  /** A refusal that leaves the door standing: the room is locked, or the queue is full. */
  const retryableRefusal = $derived.by((): GuestRefusal | null => {
    if (arrivalFailure === null) return null;
    const refusal = guestRefusalOf(arrivalFailure);
    return refusal !== null && refusal.retryable ? refusal : null;
  });

  const denied = $derived(client.failureReason === DENIED_REASON);
  const removed = $derived(client.failureReason === REMOVED_REASON);
  const withdrawn = $derived(client.failureReason === WITHDRAWN_REASON);
  const superseded = $derived(client.failureReason === SUPERSEDED_REASON);
  const outOfDate = $derived(client.failureReason === PROTOCOL_MISMATCH_REASON);
  const over = $derived(
    (client.state === "ended" && !closedByLeaving) || summary?.status === "ended",
  );
  /*
   * Standing at the door. Every guest arrival is answered at the door, so the waiting surface is
   * drawn from the moment the arrival lands rather than from the first lobby frame: a moment of
   * blank page between the two would read as the link having failed.
   */
  const atTheDoor = $derived(
    client.state === "waiting" || (client.state === "joining" && grant !== null),
  );
  const inTheRoom = $derived(
    linkRefusal === null &&
      (client.state === "live" ||
        (client.state === "failed" && !denied && !removed && !withdrawn) ||
        superseded ||
        outOfDate),
  );

  // ---- what the header says -------------------------------------------------------------------

  const firmName = $derived(summary?.firmName ?? "");
  const title = $derived(summary?.title ?? "Meeting");

  /** The zone's shortcode on the record's own day, since PST and PDT are one zone half a year apart. */
  const zoneCode = $derived.by(() => {
    if (summary === null) return "";
    try {
      return formatTimeZoneAbbreviation(
        summary.timeZone,
        new Date(instantForCivilDateTime(summary.startsOn, summary.startsAtTime, summary.timeZone)),
      );
    } catch {
      return "";
    }
  });

  /*
   * The clock in the EVENT'S zone, stated once with its shortcode: a hearing at nine in Denver is at
   * nine for everybody reading it, including a client in another state.
   */
  const startsAt = $derived(
    summary === null
      ? null
      : formatWallClock(summary.startsAtTime, summary.timeZone, summary.timeZone),
  );
  const endsAt = $derived(
    summary === null
      ? null
      : formatWallClock(summary.endsAtTime, summary.timeZone, summary.timeZone),
  );
  const whenLine = $derived.by(() => {
    if (summary === null) return null;
    const day = formatDate(summary.startsOn);
    return startsAt === null ? day : `${day} at ${startsAt} ${zoneCode}`.trim();
  });
  const medium = $derived(summary?.medium ?? "video");
  const kindWord = $derived(medium === "audio" ? "Call" : "Meeting");

  // ---- what the room draws ----------------------------------------------------------------------

  const tiles = $derived(meetingTiles(client, displayName));
  const sharedScreen = $derived(sharedScreenTile(client, displayName));
  const spotlight = $derived(
    client.speakerView && client.medium === "video" ? speakerViewTile(tiles) : null,
  );
  const uplink = $derived(connectionUplink(client));
  const connectionRoom = $derived(connectionParticipants(client));
  const wireEvents = $derived(connectionEvents(client.diagnostics.recent));

  function toggleSharing(): void {
    if (client.sharing) void client.stopSharing();
    else void client.shareScreen();
  }
</script>

<svelte:head>
  <title>{title}</title>
  <!-- This page's own address is the link, so nothing it asks for may name it as the referrer. Every
       guest call also says so for itself; this covers whatever the page loads that is not a call. -->
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<svelte:window onpagehide={departOnUnload} onbeforeunload={departOnUnload} />

{#snippet reactionsControl()}
  <MeetingReactions onReact={(name) => client.react(name)} />
{/snippet}

{#snippet chatControl()}
  <MeetingChatPanel
    bind:open={chatOpen}
    bind:draft={chatDraft}
    messages={chat.messages}
    unread={chat.unread}
    loading={chat.reading}
    failed={chat.readFailure !== null && chat.messages.length === 0}
    sending={chat.sending}
    nameOf={chatSenderName}
    canTakeBack={() => false}
    onSend={(body) => chat.send(body)}
    onTakeBack={() => undefined}
  >
    {#snippet readFailure()}
      {#if chat.readFailure !== null}
        <FailureNotice
          failure={chat.readFailure}
          subject="This meeting"
          title="Nothing Could Be Read"
          fallback="What has been said in this meeting could not be read."
          whenSilent="Nothing answered. What has been said in this meeting could not be read."
          onRetry={() => void chat.refresh()}
        />
      {/if}
    {/snippet}
    {#snippet writeFailure()}
      {#if chat.writeFailure !== null}
        <FailureNotice
          failure={chat.writeFailure}
          subject="This meeting"
          title="Nothing Was Said"
          fallback="That did not reach this meeting's record."
          whenSilent="Nothing answered, so nothing was said in this meeting."
        />
      {/if}
    {/snippet}
  </MeetingChatPanel>
{/snippet}

{#snippet refusalCard(refusal: GuestRefusal)}
  <AuthPanel title={refusal.title}>
    <p class="text-sm">{refusal.sentence}</p>
  </AuthPanel>
{/snippet}

<div class="flex h-dvh min-h-0 flex-col bg-surface-sunken">
  <!-- The one band of chrome, and all it carries is whose meeting this is. -->
  <TopBar.Root class="ps-16">
    <span class="min-w-0 truncate text-sm font-medium text-chrome-text">{firmName}</span>
  </TopBar.Root>

  {#if inTheRoom && summary !== null}
    {@const meeting = summary}
    <main class="flex min-h-0 flex-1 flex-col gap-16 overflow-hidden bg-surface-default p-24">
      <ScreenHeader {title} favoritable={false}>
        {#snippet meta()}
          <span>{firmName}</span>
          <span>{formatDate(meeting.startsOn)}</span>
          {#if startsAt !== null}
            <span>{endsAt === null ? startsAt : `${startsAt} to ${endsAt}`} {zoneCode}</span>
          {/if}
          <span>{kindWord}</span>
          {#if client.roomState.locked}
            <span>Locked</span>
          {/if}
          <MeetingReactionCounts counts={client.reactions.counts} />
        {/snippet}
      </ScreenHeader>

      {#if superseded}
        <!-- No Rejoin: this guest is already back in the room somewhere else, and a Rejoin here
             would take the stay off the window that is actually in the meeting. -->
        <Alert.Root variant="info">
          <Alert.Title>This Meeting Moved</Alert.Title>
          <Alert.Description>
            {refusalStatement({ reason: SUPERSEDED_REASON, errorId: null })}
          </Alert.Description>
        </Alert.Root>
      {:else if outOfDate}
        <Alert.Root variant="warning">
          <Alert.Title>This Page Is Out of Date</Alert.Title>
          <Alert.Description>
            This page was open while the meeting service was updated, so it no longer understands
            what the room is sending. Reload the page and join again.
          </Alert.Description>
        </Alert.Root>
      {:else if client.state === "failed"}
        <div class="flex flex-col items-start gap-8">
          <Alert.Root variant="warning">
            <Alert.Title>The Room Stopped Answering</Alert.Title>
            <Alert.Description>
              The connection to the room ended and nothing is being sent or received.
            </Alert.Description>
          </Alert.Root>
          <Button variant="secondary" disabled={arriving} onclick={rejoin}>Rejoin</Button>
          {#if arrivalFailure !== null && linkRefusal === null && retryableRefusal === null}
            <FailureNotice
              failure={arrivalFailure}
              subject="This meeting"
              title="You Are Not in the Room"
              fallback="You were not joined to this meeting."
              whenSilent="Nothing answered. You were not joined to this meeting."
            />
          {/if}
        </div>
      {/if}

      {#if client.captureRefusal !== null}
        <Alert.Root variant="info">
          <Alert.Title>Nothing Is Being Sent</Alert.Title>
          <Alert.Description>{client.captureRefusal}</Alert.Description>
        </Alert.Root>
      {/if}

      {#if client.lastRefusal !== null}
        <FailureBand
          variant="warning"
          title="Something Did Not Reach the Room"
          message={refusalStatement(client.lastRefusal)}
          errorId={client.lastRefusal.errorId}
        />
      {/if}

      {#if client.lastProblem !== null}
        <Alert.Root variant="warning">
          <Alert.Title>Something Did Not Finish</Alert.Title>
          <Alert.Description>{client.lastProblem}</Alert.Description>
        </Alert.Root>
      {/if}

      <!-- What a host did to this guest's microphone, which is not an error: a microphone that goes
           dead with nothing on screen reads as a broken machine. -->
      {#if client.lastNotice !== null}
        <Alert.Root variant="info">
          <Alert.Title>Your Microphone</Alert.Title>
          <Alert.Description>{client.lastNotice}</Alert.Description>
        </Alert.Root>
      {/if}

      {#if client.unmuteRequest !== null}
        <div class="flex flex-col items-start gap-8">
          <Alert.Root variant="info">
            <Alert.Title>A Host Asked You to Unmute</Alert.Title>
            <Alert.Description>
              Nothing has changed. Your microphone stays off until you turn it on.
            </Alert.Description>
          </Alert.Root>
          <div class="flex flex-wrap items-center gap-8">
            <Button variant="secondary" onclick={() => client.toggleMicrophone()}>Unmute</Button>
            <Button variant="ghost" onclick={() => client.declineUnmuteRequest()}>
              Stay Muted
            </Button>
          </div>
        </div>
      {/if}

      <MeetingAudio streams={client.remoteStreams} />

      <div class="flex min-h-0 flex-1 gap-16">
        <div class="min-h-0 min-w-0 flex-1">
          <MeetingGrid
            {tiles}
            {sharedScreen}
            {spotlight}
            medium={client.medium}
            page={client.page}
            pages={client.pages}
            roomSize={client.participants.length}
            onPage={(wanted) => client.setPage(wanted)}
            onPin={(participantId) =>
              client.isPinned(participantId)
                ? client.unpin(participantId)
                : client.pin(participantId)}
          />
        </div>
        <aside class="hidden min-h-0 w-3xs shrink-0 lg:block">
          <!-- Names, marks and nothing that reaches a member's identity: the room has already taken
               the member handles out of what it sends a guest, and the rail does not reach for them
               either. -->
          <MeetingRoster
            participants={client.participants}
            ownParticipantId={client.participantId}
            presenceOf={(participant) => client.presenceOf(participant)}
            qualityOf={(participant) => client.qualityOf(participant.participantId)}
            spotlightedParticipantId={client.roomState.spotlight?.participantId ?? null}
            showIdentifiers={false}
          />
        </aside>
      </div>

      <div aria-live="polite" class="sr-only">{client.reactions.announcement}</div>

      <!-- Microphone, camera, share and leave, and the chat and signals everybody in the room has.
           Never End and never a host control: a guest cannot hold a grant on this room, and a
           control they could press and be refused by would say they could. -->
      <MeetingControls
        microphoneOn={client.microphoneOn}
        cameraOn={client.cameraOn}
        sharing={client.sharing}
        speakerView={client.speakerView}
        medium={client.medium}
        canEnd={false}
        hosting={false}
        handRaised={client.reactions.hand}
        onToggleMicrophone={() => client.toggleMicrophone()}
        onToggleCamera={() => client.toggleCamera()}
        onToggleSharing={toggleSharing}
        onToggleHand={() => (client.reactions.hand ? client.lowerHand() : client.raiseHand())}
        onToggleSpeakerView={() => client.toggleSpeakerView()}
        onLeave={() => void leave()}
        chat={chatControl}
        reactions={reactionsControl}
      >
        {#snippet connection()}
          <MeetingConnectionPanel {uplink} participants={connectionRoom} events={wireEvents} />
        {/snippet}
      </MeetingControls>
    </main>
  {:else}
    <main class="flex min-h-0 flex-1 items-center justify-center mc-scrollbar overflow-y-auto p-24">
      <LoadingRegion class="flex w-full justify-center" loading={reading} label="Reading this meeting">
        {#snippet fixture()}
          <AuthPanel title={sampleMatter(0).title}>
            <p class="text-sm">{SAMPLE_SENTENCE}</p>
          </AuthPanel>
        {/snippet}

        {#if linkRefusal !== null}
          {@render refusalCard(linkRefusal)}
        {:else if readFailure !== null}
          <AuthPanel title="This Meeting Could Not Be Read">
            <FailureNotice
              failure={readFailure}
              subject="This meeting"
              fallback="This meeting could not be read."
              whenSilent="Nothing answered. This meeting could not be read."
              onRetry={() => void readSummary()}
            />
          </AuthPanel>
        {:else if summary !== null && left}
          <EmptyState title="You Left the Meeting">
            Your link still works until it expires, so you can go back to the door and be let in
            again.
            {#snippet actions()}
              <Button variant="secondary" onclick={returnToTheDoor}>Go Back to the Door</Button>
            {/snippet}
          </EmptyState>
        {:else if summary !== null && over}
          {@render refusalCard(guestRefusalNamed("meeting-ended"))}
        {:else if denied}
          {@render refusalCard(guestRefusalNamed("meeting-not-admitted"))}
        {:else if removed}
          {@render refusalCard(guestRefusalNamed("meeting-removed"))}
        {:else if withdrawn}
          {@render refusalCard(guestRefusalNamed("meeting-removed"))}
        {:else if summary !== null && atTheDoor}
          <!-- The member's own waiting surface, unchanged: what somebody at the door sees does not
               depend on whether they are at the firm. -->
          <MeetingLobbyWait
            {title}
            when={whenLine}
            place={client.waiting}
            {leaving}
            onLeave={() => void leave()}
          />
        {:else if summary !== null}
          <AuthPanel {title}>
            {#snippet meta()}
              <span>{firmName}</span>
              {#if whenLine !== null}<span>{whenLine}</span>{/if}
              <span>{kindWord}</span>
            {/snippet}
            <GuestArrival
              invitedName={summary.invitedName}
              medium={summary.medium}
              seams={deviceSeams}
              joining={arriving}
              onJoin={({ confirmedName, microphoneId, cameraId }) =>
                void arrive(confirmedName, { microphoneId, cameraId })}
            >
              {#snippet notice()}
                {#if retryableRefusal !== null}
                  <Alert.Root variant="info">
                    <Alert.Title>{retryableRefusal.title}</Alert.Title>
                    <Alert.Description>{retryableRefusal.sentence}</Alert.Description>
                  </Alert.Root>
                {:else if arrivalFailure !== null}
                  <FailureNotice
                    failure={arrivalFailure}
                    subject="This meeting"
                    title="You Are Not at the Door"
                    fallback="You were not joined to this meeting."
                    whenSilent="Nothing answered. You were not joined to this meeting."
                  />
                {/if}
              {/snippet}
            </GuestArrival>
          </AuthPanel>
        {/if}
      </LoadingRegion>
    </main>
  {/if}
</div>
