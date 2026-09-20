<script lang="ts">
  /*
   * The room. A working surface: the tiles take the height, the controls sit under them, and the
   * roster stands beside.
   *
   * THE ORDER OF ARRIVAL IS THE WHOLE OF THIS FILE. Joining is a WRITE that opens the member's
   * attendance row, and the room refuses a socket upgrade from somebody with no open attendance —
   * so the sequence is join, then open the socket with what the join answered, then publish. Doing
   * any two of those at once produces a refused upgrade that reads exactly like a broken socket.
   *
   * LEAVING IS ITS OWN ACT, AND THE SCREEN MAKES IT ON EVERY WAY OUT. The socket closing does not
   * close attendance on the server (meetings-api.ts says why), so a member who navigates away
   * without this would stay in the record as still in the room — and the room's cap would still be
   * counting them. The control does it, and so does leaving the page.
   *
   * WHAT IS NOT CONFIGURED IS SAID, NOT HIDDEN. A deployment with no conferencing credentials
   * answers the join with a 503, and that is rendered through the same failure surface as any other
   * refusal: the member learns that the firm has not turned meetings on, rather than watching a
   * screen that never fills.
   */
  import { onDestroy } from "svelte";
  import { page } from "$app/state";
  import { beforeNavigate, goto } from "$app/navigation";
  import { createQuery } from "@tanstack/svelte-query";
  import { meetingsGetOptions } from "@magna-carta/api-client";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import FailureBand from "@magna-carta/design-system/failure-band";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { formatDate, formatTimeZoneAbbreviation } from "@magna-carta/design-system/formatters";
  import { instantForCivilDateTime } from "@magna-carta/civil-time/time-zone";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import { meetingSocketUrl } from "$lib/api/socket-url.ts";
  import { leaveMeetingOnDeparture } from "$lib/api/departure-write.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { formatWallClock } from "$lib/calendar/calendar-api.ts";
  import {
    MeetingClient,
    browserMeetingSeams,
    PROTOCOL_MISMATCH_REASON,
    refusalStatement,
    REMOVED_REASON,
    SUPERSEDED_REASON,
    type MeetingMedium,
    type MeetingParticipant,
  } from "$lib/meetings/client/meeting-client.svelte.ts";
  import {
    meetingTiles,
    participantName,
    sharedScreenTile,
    speakerViewTile,
    type MeetingTileModel,
  } from "$lib/meetings/screen/meeting-tiles.ts";
  import MeetingHostMenu from "$lib/meetings/meeting-host-menu.svelte";
  import MeetingHostsPanel from "$lib/meetings/meeting-hosts-panel.svelte";
  import MeetingAudio from "$lib/meetings/screen/meeting-audio.svelte";
  import MeetingGrid from "$lib/meetings/screen/meeting-grid.svelte";
  import MeetingControls from "$lib/meetings/screen/meeting-controls.svelte";
  import MeetingRoster from "$lib/meetings/screen/meeting-roster.svelte";
  import MeetingConnectionPanel from "$lib/meetings/screen/meeting-connection-panel.svelte";
  import {
    connectionEvents,
    connectionParticipants,
    connectionUplink,
  } from "$lib/meetings/screen/meeting-connection.ts";
  import {
    endMeeting,
    eventAddress,
    grantMeetingHosting,
    joinMeeting,
    leaveMeeting,
    readMeetingHosts,
    refusedAs,
    removeMeetingParticipant,
    revokeMeetingHosting,
    setMeetingLocked,
    type MeetingWrite,
  } from "$lib/meetings/meetings-api.ts";
  import type { MeetingHostGrant } from "@magna-carta/api-client";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { Failure } from "$lib/api/problem.ts";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";

  const meetingId = $derived(page.params.id ?? "");

  const summaryRead = createQuery(() => meetingsGetOptions({ path: { meetingId } }));
  const summary = $derived(summaryRead.data ?? null);

  const client = new MeetingClient(browserMeetingSeams());

  /** The join's refusal, where joining is what failed. Null while nothing has. */
  let joinFailure = $state<Failure | null>(null);
  /** The end's refusal, rendered in the confirmation panel's own band. */
  let endRefusal = $state<Failure | null>(null);
  /**
   * The meeting this browser currently holds an attendance row on, or null.
   *
   * It is the meeting ID rather than a flag because the address can change WITHOUT this component
   * being destroyed — SvelteKit reuses a page across a parameter change — so a flag would leave a
   * member who walked from one meeting to another joined to neither.
   */
  let joinedMeetingId = $state<string | null>(null);
  /**
   * The meeting this browser has already left, so nothing walks back into it on its own.
   *
   * LETTING GO OF A MEETING AND NEVER HAVING JOINED ONE LOOK THE SAME to the arrival below, and both
   * departures let go by clearing `joinedMeetingId` — so without this the effect starts a FRESH join
   * as the tab closes: a POST racing the departure's own leave, which, if the leave lands first,
   * opens a stay that no socket ever reaches and that nothing closes but the server's sweep.
   *
   * It holds the meeting rather than a flag for the reason `joinedMeetingId` does: a member walking
   * from one meeting to another keeps this component, and a flag would leave them in neither room.
   */
  let departedMeetingId = $state<string | null>(null);
  /** True while a leave is in flight, so the way out cannot be taken twice. */
  let leaving = $state(false);

  $effect(() => {
    void sessionPermissions.load(fetch);
  });

  const canHost = $derived(sessionPermissions.holds("meetings:host"));

  /*
   * The name this browser is drawn under. The join answers with it, which is the server's own
   * reading of who is asking; until it answers there is no tile to label.
   */
  let displayName = $state("You");

  /*
   * Arrive: join, open the socket with what the join answered, publish. It runs once per meeting —
   * the meeting is recorded as joined BEFORE the write, so a second render cannot start a second
   * attendance on it.
   */
  $effect(() => {
    const id = meetingId;
    if (id === "" || joinedMeetingId === id || summary === null) return;
    // A room this browser has already been in and out of is not walked back into on its own; that
    // is what the Rejoin control is for. Both halves of that are needed: the state covers a meeting
    // the room closed, and the departure covers one this browser left, which leaves the client
    // holding no state at all.
    if (client.state === "ended" || departedMeetingId === id) return;
    // The summary in hand may still be the PREVIOUS meeting's for a frame after the address moved,
    // and joining on it would read the wrong standing.
    if (summary.id !== id) return;
    // A meeting nobody can be in is not joined: a 503 or a closed room would be the answer, and
    // asking for it would open an attendance row on a meeting that is over.
    if (!summary.configured || summary.status === "ended") return;
    joinedMeetingId = id;
    leaving = false;
    void arrive(id, summary.medium);
  });

  async function arrive(id: string, medium: MeetingMedium): Promise<void> {
    const outcome = await joinMeeting(id);
    if (outcome.kind !== "ok") {
      joinFailure = outcome.failure;
      return;
    }
    joinFailure = null;
    displayName = outcome.value.displayName;
    client.join({
      meetingId: id,
      participantId: outcome.value.participantId,
      iceServers: outcome.value.iceServers,
      socketUrl: meetingSocketUrl(id),
      // The record's own answer, not this screen's guess: it decides whether a camera is captured
      // at all, and it was settled when somebody opened the room.
      medium,
    });
    await client.publish();
  }

  /*
   * Go: tell the room, close the attendance row, and go back to the event this meeting hangs on.
   * The write is not awaited before navigating away on a teardown — see `depart` below — but it is
   * here, because a member who pressed Leave is watching and a failure is theirs to see.
   */
  async function leave(): Promise<void> {
    const id = joinedMeetingId;
    if (leaving || id === null) return;
    leaving = true;
    joinedMeetingId = null;
    departedMeetingId = id;
    client.leave();
    await leaveMeeting(id);
    await goto(backAddress);
  }

  /*
   * The same act on the way out of the page, best effort. A navigation cannot be held open for a
   * round trip, so the write is fired and the member is let go; the room also drops the socket, and
   * a stay this never reached is closed by the server about a minute after the socket is lost.
   */
  function depart(): void {
    const id = joinedMeetingId;
    if (id === null) return;
    joinedMeetingId = null;
    departedMeetingId = id;
    client.dispose();
    void leaveMeeting(id);
  }

  /*
   * Closing the tab, which reaches neither of the two above: `beforeNavigate` is about navigation
   * inside the app and `onDestroy` never runs on a document being torn down. Without this the member
   * stays in the room until the server's grace period closes them out, which is a minute of a tile
   * nobody is behind — so the write goes out on the way down, on the one transport that survives the
   * page (`$lib/api/departure-write.ts` says why it is not the generated client).
   *
   * BOTH EVENTS, AND NEITHER TWICE. `pagehide` is the one that fires in every case, the back/forward
   * cache included; `beforeunload` is the fallback where a browser gives only that. Clearing the
   * meeting first is what makes the second of the two a no-op, so one departure is sent, not two.
   */
  function departOnUnload(): void {
    const id = joinedMeetingId;
    if (id === null) return;
    joinedMeetingId = null;
    departedMeetingId = id;
    client.dispose();
    leaveMeetingOnDeparture(id);
  }

  /*
   * Two ways this browser stops holding a stay without having asked to.
   *
   * The room ENDING closes every attendance on the server at one instant, so there is nothing left
   * for this browser to close on its way out and a leave sent afterwards would be asking to close a
   * row that is already closed.
   *
   * A socket SUPERSEDED by a newer one for the same stay is the other, and it is the more dangerous:
   * the stay is still open and is now the other tab's. Sending a leave from here would take the tab
   * that is actually in the room out of it — so this browser lets go of the meeting AND records it
   * as departed, which is what stops the arrival below opening a second one in its place.
   */
  $effect(() => {
    if (client.state === "ended") joinedMeetingId = null;
    if (client.failureReason === SUPERSEDED_REASON) {
      joinedMeetingId = null;
      departedMeetingId = meetingId;
    }
  });

  beforeNavigate(() => {
    depart();
  });
  onDestroy(() => {
    depart();
  });

  /*
   * RUNNING THE MEETING. Everything below is a host act, and the split between the two kinds is the
   * one the design settles: the acts that leave nothing behind go out as frames on the socket and
   * are instant, and the acts somebody could later ask "who did that" about are routes with audit
   * rows. A member who is not hosting sees none of the controls that reach either.
   */

  /** The refusal the last hosting write came back with, rendered where the act was asked for. */
  let hostingRefusal = $state<Failure | null>(null);
  /** Whether the panel naming who runs this meeting is open. */
  let hostsOpen = $state(false);
  /** The live grants, or null while the read is in flight. */
  let hostGrants = $state<readonly MeetingHostGrant[] | null>(null);
  let hostsReading = $state(false);
  let hostsFailure = $state<Failure | null>(null);

  /** How this member runs the meeting, as the roster states it. Null for most of the room. */
  const myRole = $derived(client.myRole);

  /*
   * Read who is hosting when the panel opens, and never before.
   *
   * It is not in the page's own screen data because nothing outside this panel asks it: every badge
   * on every tile comes off the roster the socket is already carrying, which is also the only place
   * a grant written mid-meeting arrives promptly. The read is for the panel's own list of WHEN each
   * grant was written, which the roster does not carry.
   */
  $effect(() => {
    if (!hostsOpen) return;
    void refreshHosts();
  });

  async function refreshHosts(): Promise<void> {
    hostsReading = true;
    const outcome = await readMeetingHosts(meetingId);
    hostsReading = false;
    if (outcome.kind === "ok") {
      hostGrants = outcome.value;
      hostsFailure = null;
      return;
    }
    hostsFailure = outcome.failure;
  }

  /** What a member is called, out of the roster this browser already holds. */
  function nameOfMember(userId: string): string {
    const participant = client.participants.find((one) => one.userId === userId);
    return participant === undefined ? "Somebody who has left" : participantName(participant);
  }

  /**
   * Whether this room has nobody running it, so a key-holder may take it.
   *
   * Read off the ROSTER rather than off the grants: a grant belonging to somebody who is not in the
   * room is exactly the state the claim exists to end, and the roster is the one list that says who
   * is actually here.
   */
  const hostless = $derived(
    client.state === "live" &&
      client.participants.length > 0 &&
      !client.participants.some((participant) => participant.hostRole !== null),
  );
  const canClaim = $derived(canHost && hostless);

  /** Run a hosting write and keep whatever it refused, for the surface that asked. */
  async function hostingWrite(
    act: () => Promise<MeetingWrite<unknown>>,
  ): Promise<ActionOutcome> {
    hostingRefusal = null;
    const outcome = await act();
    if (outcome.kind === "ok") {
      // The room rewrites its stored roles and broadcasts, so the badges and the menus follow from
      // the roster rather than from anything held here. The panel's own list is the exception: it
      // carries when each grant was written, which no frame does.
      if (hostsOpen) void refreshHosts();
      return "committed";
    }
    hostingRefusal = outcome.failure;
    return "refused";
  }

  function claimHosting(): void {
    const userId = sessionPermissions.session?.user.id;
    if (userId === undefined) return;
    void hostingWrite(() => grantMeetingHosting(meetingId, userId, "host"));
  }

  async function end(): Promise<ActionOutcome> {
    endRefusal = null;
    const outcome: MeetingWrite<unknown> = await endMeeting(meetingId);
    // Ending is not leaving: the room broadcasts `ended` and closes every socket, which is what
    // takes this browser out of the room and settles the screen on its ended state.
    if (outcome.kind === "ok") return "committed";
    endRefusal = outcome.failure;
    return "refused";
  }

  /*
   * Go back in after the socket went away. The attendance row is opened again from scratch rather
   * than the socket being re-dialled: the room refuses an upgrade from somebody with no open
   * attendance, and this browser cannot know whether the one it had was closed on the way down.
   */
  function rejoin(): void {
    joinedMeetingId = null;
    // Asked for, so the departure that closed this screen's last stay stops standing in the way.
    departedMeetingId = null;
    joinFailure = null;
  }

  function toggleSharing(): void {
    if (client.sharing) void client.stopSharing();
    else void client.shareScreen();
  }

  // ---- what the header says -------------------------------------------------------------------

  const title = $derived(summary?.title ?? "Meeting");

  /*
   * The zone's shortcode is worked out on the RECORD'S OWN DAY: the same zone is PST in January and
   * PDT in July, so a code taken from today would be wrong about half the year's meetings.
   */
  const zoneCode = $derived.by(() => {
    if (summary === null) return "";
    return formatTimeZoneAbbreviation(
      summary.timeZone,
      new Date(instantForCivilDateTime(summary.startsOn, summary.startsAtTime, summary.timeZone)),
    );
  });

  /*
   * The clock, read in the EVENT'S own zone rather than the reader's, which is why the reader zone
   * passed to the shared formatter is the event's: the zone is stated once at the end of the line
   * as a shortcode instead of being repeated in full beside every time.
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

  const backAddress = $derived(
    summary === null
      ? "/calendar"
      : eventAddress(summary.eventKind, summary.eventId, summary.matterId),
  );

  const endSubject = $derived<RecordSubject>(summary === null ? {} : { facts: [summary.title] });

  // ---- what the grid draws --------------------------------------------------------------------

  const tiles = $derived(meetingTiles(client, displayName));
  const sharedScreen = $derived(sharedScreenTile(client, displayName));
  /*
   * The large slot in speaker view, which is whoever the plan put first. There is none in the even
   * gallery, and none in a call: a call has no picture to make large.
   */
  const spotlight = $derived(
    client.speakerView && client.medium === "video" ? speakerViewTile(tiles) : null,
  );

  /*
   * The meeting is over when the room says so, and also when the record already said so before this
   * browser arrived — somebody following a link to a meeting that ended last Tuesday.
   */
  const over = $derived(client.state === "ended" || summary?.status === "ended");
  /*
   * A host put this member out of the room, or refused them at the door because they had been.
   *
   * Two routes to one state and both end here: the socket refusal while they were in it, and the
   * join's own 409 for somebody following a link back to a meeting they are barred from. There is no
   * Rejoin either way — the join would be refused, and offering it would be the screen inviting a
   * member to be told no.
   */
  const removed = $derived(
    client.failureReason === REMOVED_REASON || refusedAs(joinFailure, "meeting-removed"),
  );
  const unconfigured = $derived(summary !== null && !summary.configured);
  /*
   * This socket lost the stay to a newer one of this member's own. The meeting is NOT over — it is
   * running, with them in it, in the tab that superseded this one — so the screen says that rather
   * than reading as a room that closed.
   */
  const superseded = $derived(client.failureReason === SUPERSEDED_REASON);
  /*
   * The room is speaking a protocol this page does not know — a page left open across a deploy.
   * There is no Rejoin for it: the same page code would meet the same room again. Reloading is the
   * whole remedy, and it is the one thing the member can do themselves.
   */
  const outOfDate = $derived(client.failureReason === PROTOCOL_MISMATCH_REASON);
  /*
   * What this room IS, named on the header's own line beside the day and the count — because a call
   * and a meeting look different the moment you are in one (no picture, no share) and a reader
   * arriving at the address should know which they are about to join before they are in it.
   */
  const kindWord = $derived(client.medium === "audio" ? "Call" : "Meeting");

  // ---- what the connection surface draws ---------------------------------------------------------

  const uplink = $derived(connectionUplink(client));
  const connectionRoom = $derived(connectionParticipants(client));
  const wireEvents = $derived(connectionEvents(client.diagnostics.recent));
</script>

<!--
  The host's menu for one person, written once and rendered in the two places a host finds somebody:
  a tile, and a row in the rail. The rail is the one that matters in a large room — sixteen of three
  hundred people have a tile, and all three hundred have a row that can be searched.
-->
{#snippet hostMenuFor(
  participantId: string,
  userId: string | null,
  name: string,
  targetRole: MeetingParticipant["hostRole"],
)}
  <MeetingHostMenu
    {name}
    viewerRole={myRole}
    {targetRole}
    spotlighted={client.roomState.spotlight?.participantId === participantId}
    onMute={() => client.mute(participantId)}
    onAskToUnmute={() => client.askToUnmute(participantId)}
    onSpotlight={(wanted) => client.spotlight(wanted ? participantId : null)}
    onMakeCoHost={() =>
      userId === null
        ? undefined
        : void hostingWrite(() => grantMeetingHosting(meetingId, userId, "co-host"))}
    onWithdrawCoHost={() =>
      userId === null
        ? undefined
        : void hostingWrite(() => revokeMeetingHosting(meetingId, userId))}
    onHandHosting={() =>
      userId === null
        ? Promise.resolve<ActionOutcome>("refused")
        : hostingWrite(() => grantMeetingHosting(meetingId, userId, "host"))}
    onRemove={() => hostingWrite(() => removeMeetingParticipant(meetingId, participantId))}
  >
    {#snippet writeFailure()}
      {@render hostingFailure()}
    {/snippet}
  </MeetingHostMenu>
{/snippet}

{#snippet tileMenu(tile: MeetingTileModel)}
  {@render hostMenuFor(tile.participantId ?? "", tile.userId, tile.name, tile.hostRole)}
{/snippet}

{#snippet rowMenu(participant: MeetingParticipant)}
  {@render hostMenuFor(
    participant.participantId,
    participant.userId,
    participantName(participant),
    participant.hostRole,
  )}
{/snippet}

<!-- One reading of a refused hosting write, rendered wherever the act was asked for. -->
{#snippet hostingFailure()}
  {#if hostingRefusal !== null}
    <FailureNotice
      failure={hostingRefusal}
      subject="This meeting"
      title="Nothing Changed"
      fallback="That did not happen."
      whenSilent="Nothing answered, so nothing changed in this meeting."
    />
  {/if}
{/snippet}

<svelte:head><title>{title} · Magna Carta</title></svelte:head>

<svelte:window onpagehide={departOnUnload} onbeforeunload={departOnUnload} />

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader {title} back="meetings">
    {#snippet meta()}
      {#if summary !== null}
        <span>{formatDate(summary.startsOn)}</span>
        {#if startsAt !== null}
          <span>{endsAt === null ? startsAt : `${startsAt} to ${endsAt}`} {zoneCode}</span>
        {/if}
        <span>{kindWord}</span>
        {#if client.roomState.locked}
          <!-- On the line that already carries the day and the head count, because whether the
               door is shut is a fact about the room rather than an act anybody here can take. -->
          <span>Locked</span>
        {/if}
        <span>{summary.liveCount === 1 ? "1 in the room" : `${summary.liveCount} in the room`}</span>
      {/if}
    {/snippet}
  </ScreenHeader>

  <LoadingRegion
    class="flex min-h-0 flex-1 flex-col gap-16"
    loading={summaryRead.isPending}
    label="Reading this meeting"
    failed={summaryRead.isError}
  >
    {#snippet failure()}
      <FailureNotice
        failure={failureOf(summaryRead.error)}
        subject="This meeting"
        fallback="This meeting could not be read."
        whenSilent="Nothing answered. This meeting could not be read."
        onRetry={() => void summaryRead.refetch()}
      />
    {/snippet}

    {#if unconfigured}
      <EmptyState title="Meetings Are Not Turned On">
        Meetings have not been turned on for this firm, so a room cannot be opened here. An
        administrator is who puts that right.
        {#snippet actions()}
          <Button variant="secondary" href={backAddress}>Back to the Event</Button>
        {/snippet}
      </EmptyState>
    {:else if over}
      <EmptyState title="Meeting Ended">
        The room is closed. Who was in it and for how long stays on the record.
        {#snippet actions()}
          <Button variant="secondary" href={backAddress}>Back to the Event</Button>
        {/snippet}
      </EmptyState>
    {:else if removed}
      <EmptyState title="You Were Removed From This Meeting">
        A host took you out of the room. You cannot come back into this meeting, and the record
        keeps when your stay began and when it ended.
        {#snippet actions()}
          <Button variant="secondary" href={backAddress}>Back to the Event</Button>
        {/snippet}
      </EmptyState>
    {:else if joinFailure !== null}
      <FailureNotice
        failure={joinFailure}
        subject="This meeting"
        title="You Are Not in the Room"
        fallback="You were not joined to this meeting."
        whenSilent="Nothing answered. You were not joined to this meeting."
      />
    {:else}
      <!-- The room's own faults are not API failures and are not dressed as them: no request was
           refused, so there is no Error ID to carry and no retry that would mean anything. The
           statement says what happened and the way back in is the control beside it. -->
      {#if superseded}
        <!-- The one failure with no Rejoin beside it, and the reason is the whole of it: this
             member is already back in the room somewhere else. A Rejoin here would take the stay
             off the tab that is actually in the meeting and hand it to this one, which is the same
             collision again with the tabs swapped. -->
        <div class="flex flex-col items-start gap-8">
          <Alert.Root variant="info">
            <Alert.Title>This Meeting Moved</Alert.Title>
            <Alert.Description>
              {refusalStatement({ reason: SUPERSEDED_REASON, errorId: null })}
            </Alert.Description>
          </Alert.Root>
          <Button variant="secondary" href={backAddress}>Back to the Event</Button>
        </div>
      {:else if outOfDate}
        <!-- No Rejoin: this page and this room disagree about the wire, and pressing it would
             reach the same disagreement again. The way out is a reload, which is what it says. -->
        <div class="flex flex-col items-start gap-8">
          <Alert.Root variant="warning">
            <Alert.Title>This Page Is Out of Date</Alert.Title>
            <Alert.Description>
              This page was open while the meeting service was updated, so it no longer understands
              what the room is sending. Reload the page to join.
            </Alert.Description>
          </Alert.Root>
          <Button variant="secondary" href={backAddress}>Back to the Event</Button>
        </div>
      {:else if client.state === "failed"}
        <div class="flex flex-col items-start gap-8">
          <Alert.Root variant="warning">
            <Alert.Title>The Room Stopped Answering</Alert.Title>
            <Alert.Description>
              The connection to the room ended and nothing is being sent or received.
            </Alert.Description>
          </Alert.Root>
          <Button variant="secondary" onclick={rejoin}>Rejoin</Button>
        </div>
      {/if}

      {#if client.captureRefusal !== null}
        <Alert.Root variant="info">
          <Alert.Title>Nothing Is Being Sent</Alert.Title>
          <Alert.Description>{client.captureRefusal}</Alert.Description>
        </Alert.Root>
      {/if}

      <!-- A refusal the meeting SURVIVED, which is most of them: the room said no to one frame and
           stayed open, so this states what did not happen without taking anybody out of the room.
           The Error ID rides with it where the room issued one, the way every other surface carries
           one — it is what support is quoted. -->
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

      <!-- WHAT A HOST DID TO THIS MEMBER, and it is not an error. A microphone that goes dead with
           nothing on screen is read as a broken machine, so the room says what happened; the way
           back is the ordinary microphone control, which republishes. -->
      {#if client.lastNotice !== null}
        <Alert.Root variant="info">
          <Alert.Title>Your Microphone</Alert.Title>
          <Alert.Description>{client.lastNotice}</Alert.Description>
        </Alert.Root>
      {/if}

      <!-- ASKED, NOT OPENED. Nothing on this platform can turn somebody's microphone on from
           another member's click, so the request arrives as a question with no default: the member
           may be in a room with a client, on a call they muted themselves for. -->
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

      <!-- Every voice the room is sending, played once and out of sight. It sits outside the grid
           because the people heard are not the people shown: whoever speaks from another page is
           pulled and played while their tile is nowhere on this one. -->
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
            hostMenu={myRole === null ? undefined : tileMenu}
          />
        </div>
        <aside class="hidden min-h-0 w-3xs shrink-0 lg:block">
          <MeetingRoster
            participants={client.participants}
            ownParticipantId={client.participantId}
            presenceOf={(participant) => client.presenceOf(participant)}
            qualityOf={(participant) => client.qualityOf(participant.participantId)}
            spotlightedParticipantId={client.roomState.spotlight?.participantId ?? null}
            hostMenu={myRole === null ? undefined : rowMenu}
          />
        </aside>
      </div>

      <MeetingControls
        microphoneOn={client.microphoneOn}
        cameraOn={client.cameraOn}
        sharing={client.sharing}
        speakerView={client.speakerView}
        medium={client.medium}
        canEnd={canHost}
        hosting={myRole !== null}
        locked={client.roomState.locked}
        spotlighted={client.roomState.spotlight !== null}
        subtitle={endSubject}
        onToggleMicrophone={() => client.toggleMicrophone()}
        onToggleCamera={() => client.toggleCamera()}
        onToggleSharing={toggleSharing}
        onToggleSpeakerView={() => client.toggleSpeakerView()}
        onMuteAll={() => client.muteAll()}
        onSetLocked={(wanted) => void hostingWrite(() => setMeetingLocked(meetingId, wanted))}
        onClearSpotlight={() => client.spotlight(null)}
        onOpenHosts={() => (hostsOpen = true)}
        onLeave={() => void leave()}
        onEnd={end}
      >
        {#snippet connection()}
          <MeetingConnectionPanel
            {uplink}
            participants={connectionRoom}
            events={wireEvents}
          />
        {/snippet}

        {#snippet endFailure()}
          {#if endRefusal !== null}
            <!-- AN AUTHORITY ANSWER RATHER THAN A PERMISSION ONE. The member holds the key; what
                 they do not hold is a grant on this room. Somebody hosting it can hand it to them,
                 and where nobody is running it at all they may take it. -->
            <FailureNotice
              failure={endRefusal}
              subject="This meeting"
              title={refusedAs(endRefusal, "meeting-not-host")
                ? "You Are Not Hosting This Meeting"
                : "Nothing Changed"}
              fallback={refusedAs(endRefusal, "meeting-not-host")
                ? "Only somebody hosting this meeting can end it."
                : "The meeting was not ended."}
              whenSilent="Nothing answered. The meeting was not ended and is still running."
            />
            {#if refusedAs(endRefusal, "meeting-not-host") && canClaim}
              <Button variant="secondary" onclick={claimHosting}>Claim Hosting</Button>
            {/if}
          {/if}
        {/snippet}
      </MeetingControls>

      <!-- Who is running this meeting. Open to everybody in the room — the grants read rides on the
           permission to JOIN, because everybody a decision governs may know who makes it — and what
           changes with the reader is only what they may do here. -->
      <MeetingHostsPanel
        bind:open={hostsOpen}
        subject={endSubject}
        grants={hostGrants}
        loading={hostsReading && hostGrants === null}
        failed={hostsFailure !== null}
        nameOf={nameOfMember}
        canWithdraw={myRole === "host"}
        {canClaim}
        onWithdraw={(userId) => void hostingWrite(() => revokeMeetingHosting(meetingId, userId))}
        onClaim={claimHosting}
      >
        {#snippet readFailure()}
          {#if hostsFailure !== null}
            <FailureNotice
              failure={hostsFailure}
              subject="This meeting"
              fallback="Who is hosting this meeting could not be read."
              whenSilent="Nothing answered. Who is hosting this meeting could not be read."
              onRetry={() => void refreshHosts()}
            />
          {/if}
        {/snippet}

        {#snippet writeFailure()}
          {@render hostingFailure()}
        {/snippet}
      </MeetingHostsPanel>
    {/if}
  </LoadingRegion>
</div>
