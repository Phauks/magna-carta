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
   *
   * A RECORDING IS ANNOUNCED, MARKED AND LISTED HERE, and lit by the room alone. The banner, the live
   * region and the mark in the header are drawn from what the room announced to everybody, never
   * from this member's own press; Record asks first, in the one panel the product asks acts in, and
   * says that everybody, guests included, will be told. What has been recorded is a reading panel
   * over the product's one grid, opened from the header.
   */
  import { onDestroy, untrack } from "svelte";
  import { page } from "$app/state";
  import { beforeNavigate, goto } from "$app/navigation";
  import { closeMeetingTab } from "$lib/meetings/meeting-tab.ts";
  import { createQuery } from "@tanstack/svelte-query";
  import { meetingsGetOptions } from "@magna-carta/api-client";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import FailureBand from "@magna-carta/design-system/failure-band";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import {
    formatDate,
    formatInstant,
    formatTimeZoneAbbreviation,
  } from "@magna-carta/design-system/formatters";
  import { instantForCivilDateTime } from "@magna-carta/civil-time/time-zone";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { failureOf } from "$lib/api/api-client.ts";
  import { toast } from "@magna-carta/design-system/toast";
  import { meetingSocketUrl } from "$lib/api/socket-url.ts";
  import { leaveMeetingOnDeparture } from "$lib/api/departure-write.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { formatWallClock } from "$lib/calendar/calendar-api.ts";
  import {
    DENIED_REASON,
    DENIED_STATEMENT,
    MeetingClient,
    browserMeetingSeams,
    PROTOCOL_MISMATCH_REASON,
    ENCRYPTION_UNSUPPORTED_REASON,
    refusalStatement,
    REMOVED_REASON,
    SOCKET_CLOSED_REASON,
    SUPERSEDED_REASON,
    type MeetingLobbyMode,
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
  import MeetingLobbyPanel from "$lib/meetings/meeting-lobby-panel.svelte";
  import MeetingLobbyWait from "$lib/meetings/meeting-lobby-wait.svelte";
  import MeetingGuestsPanel from "$lib/meetings/meeting-guests-panel.svelte";
  import MoveToMatterDialog from "$lib/meetings/move-to-matter-dialog.svelte";
  import { readWaitingParticipants } from "$lib/meetings/client/lobby.ts";
  import UsersRound from "@lucide/svelte/icons/users-round";
  import FolderInput from "@lucide/svelte/icons/folder-input";
  import Disc from "@lucide/svelte/icons/disc";
  import Link from "@lucide/svelte/icons/link";
  import Share2 from "@lucide/svelte/icons/share-2";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import RecordingMark from "$lib/meetings/screen/recording-mark.svelte";
  import RecordingNotice from "$lib/meetings/screen/recording-notice.svelte";
  import RecordingList from "$lib/meetings/screen/recording-list.svelte";
  import { recordingRefusal } from "$lib/meetings/client/recording.svelte.ts";
  import { guestAttendeeLabel } from "$lib/meetings/screen/meeting-host-labels.ts";
  import MeetingAudio from "$lib/meetings/screen/meeting-audio.svelte";
  import MeetingGrid from "$lib/meetings/screen/meeting-grid.svelte";
  import MeetingControls from "$lib/meetings/screen/meeting-controls.svelte";
  import MeetingRoster from "$lib/meetings/screen/meeting-roster.svelte";
  import MeetingConnectionPanel from "$lib/meetings/screen/meeting-connection-panel.svelte";
  import MeetingChatPanel from "$lib/meetings/screen/meeting-chat-panel.svelte";
  import MeetingSidePanel, {
    type MeetingSideTab,
  } from "$lib/meetings/screen/meeting-side-panel.svelte";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import MeetingHandsPanel from "$lib/meetings/screen/meeting-hands-panel.svelte";
  import MeetingPollsPanel from "$lib/meetings/screen/meeting-polls-panel.svelte";
  import { MeetingPolls, membersWhoCanAnswer } from "$lib/meetings/client/polls.svelte.ts";
  import {
    MAX_MEETING_QUESTION_LENGTH,
    MeetingQuestions,
    type MeetingQuestionView,
  } from "$lib/meetings/client/questions.svelte.ts";
  import type { EffectsChange, MediaEffectSettings } from "$lib/meetings/client/media-effects.ts";
  import { meetingEffectsPreference } from "$lib/meetings/meeting-effects-preference.svelte.ts";
  import { meetingViewPreference } from "$lib/meetings/meeting-view-preference.svelte.ts";
  import { meetingRoomAddress } from "$lib/meetings/meeting-tab.ts";
  import { keepBackgroundImage } from "$lib/meetings/effects/background-image-store.ts";
  import MeetingReactionCounts from "$lib/meetings/screen/meeting-reaction-counts.svelte";
  import MeetingReactions from "$lib/meetings/screen/meeting-reactions.svelte";
  import { MeetingChat, meetingChatSeams } from "$lib/meetings/client/chat.svelte.ts";
  import {
    connectionEvents,
    connectionParticipants,
    connectionUplink,
  } from "$lib/meetings/screen/meeting-connection.ts";
  import {
    admitToMeetingLobby,
    denyFromMeetingLobby,
    doorDecisionStatement,
    endMeeting,
    eventAddress,
    grantMeetingHosting,
    joinMeeting,
    leaveMeeting,
    MAX_MEETING_MESSAGE_LENGTH,
    meetingPollSeams,
    meetingQuestionSeams,
    meetingRecordingRoutes,
    readMeetingRecordingNotices,
    recordingIsConfigured,
    readMeetingHosts,
    readMeetingLobby,
    refusedAs,
    removeMeetingParticipant,
    revokeMeetingHosting,
    setMeetingLobby,
    setMeetingLocked,
    type MeetingRecordingNoticeView,
    type MeetingRecordingView,
    type MeetingWrite,
  } from "$lib/meetings/meetings-api.ts";
  import type {
    MeetingHostGrant,
    MeetingLobbyDecisions,
    MeetingMessage,
  } from "@magna-carta/api-client";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { Failure } from "$lib/api/problem.ts";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";

  const meetingId = $derived(page.params.id ?? "");

  const summaryRead = createQuery(() => meetingsGetOptions({ path: { meetingId } }));
  const summary = $derived(summaryRead.data ?? null);

  const client = new MeetingClient(browserMeetingSeams());

  /*
   * What this member chose for their own sound and picture, remembered in this browser rather than on
   * their record: whether an effect is possible at all is a fact about this machine.
   */
  const effectsPreference = meetingEffectsPreference();
  $effect(() => effectsPreference.followAcrossTabs());

  /*
   * How this member likes the room drawn: speaker view or the gallery, and their own picture
   * mirrored or not. Remembered in this browser, and the client is told the arrangement whenever the
   * remembered one changes, another tab's change included.
   */
  const viewPreference = meetingViewPreference();
  $effect(() => viewPreference.followAcrossTabs());
  $effect(() => {
    const speaker = viewPreference.current.layout === "speaker";
    untrack(() => client.setSpeakerView(speaker));
  });

  function toggleSpeakerView(): void {
    viewPreference.set({
      ...viewPreference.current,
      layout: client.speakerView ? "gallery" : "speaker",
    });
  }

  /**
   * Copy the connection's last few minutes as text, for a member to paste to whoever is helping
   * with a stutter or a frozen picture. Numbers and handles only (diagnostic-text.ts).
   */
  async function copyDiagnostics(): Promise<void> {
    const text = client.diagnostics.copyableText({
      userAgent: navigator.userAgent,
      processors: navigator.hardwareConcurrency ?? null,
      background: client.appliedEffects?.background ?? effectsPreference.current.background,
      layout: client.speakerView ? "speaker" : "gallery",
      copiedAt: new Date(),
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Diagnostics copied. Paste them into a message.");
    } catch {
      toast.error("Could not copy the diagnostics.");
    }
  }

  /**
   * Copy the room's address for somebody at the firm. It opens the same room for any member who may
   * join it; a person outside the firm is sent a guest link from Guests instead.
   */
  async function copyMeetingLink(): Promise<void> {
    const link = new URL(meetingRoomAddress(meetingId), window.location.href).href;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied. It opens this meeting for people at the firm.");
    } catch {
      toast.error("Could not copy the link. Copy it from the address bar instead.");
    }
  }

  /**
   * A change made in the Effects panel: remembered first, so the next capture on this machine asks
   * for it, and then asked of the tracks already running, whose answer is what the panel shows.
   */
  function changeEffects(settings: MediaEffectSettings, change: EffectsChange): void {
    effectsPreference.set(settings);
    void client.changeEffects(settings, change);
  }

  /**
   * Stand the member in front of a picture from their computer. It is cut down and kept in this
   * browser, so the next meeting here starts with it, and it is never uploaded.
   */
  async function chooseBackgroundImage(file: File): Promise<void> {
    let image: ImageBitmap;
    try {
      image = await keepBackgroundImage(file);
    } catch {
      client.noteEffectsRefusal("That file is not a picture this browser can show.");
      return;
    }
    effectsPreference.set({ ...effectsPreference.current, background: "image" });
    await client.chooseBackgroundImage(image);
  }

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
  /** Whether this member holds the right to record meetings at all. A grant on this room is apart. */
  const canRecord = $derived(sessionPermissions.holds("meetings:record"));

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
    void arrive(id, summary.medium, summary.encrypted);
  });

  async function arrive(id: string, medium: MeetingMedium, encrypted: boolean): Promise<void> {
    /*
     * The recording tone's audio is asked to run here too, before anything is awaited. The press
     * that matters happened on the screen before this one: the calendar entry's Join or Start, or
     * the Meetings page's Join, woke the page's one tone device while the press was in progress, and
     * the room chimes on that same device. Arriving any other way — an address typed or a reload —
     * Safari keeps the device suspended until the first press in the room below wakes it, and until
     * something does, a recording is announced on screen and to a screen reader without the tone,
     * never with a tone that plays late.
     */
    client.unlockRecordingSounds();
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
      // Whether this stay is at the DOOR. The server decides it — the lobby is on, and this member
      // is not running the room — and it is what stops anything being captured below.
      waiting: outcome.value.waiting,
      // What this member chose for their own sound and picture on this machine, applied at the
      // capture below and at every rejoin, so a choice made once is not made again.
      effects: effectsPreference.current,
      // The record's own answer again: whether this browser joins the meeting's key group and seals
      // what it sends. Fixed when somebody opened the room.
      encrypted,
    });
    /*
     * Asked for on every arrival, including one that is waiting: the client refuses it at the door
     * and asks again itself the moment a host admits them. A screen that decided this would be a
     * second place the camera rule is written, and the rule is that a waiter's camera light must
     * not come on.
     */
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
    // The meeting has a tab of its own, so leaving closes it and hands the member back to the tab
    // they came from. A browser closes only a tab a page opened; where it will not, this tab goes
    // back to the event instead.
    closeMeetingTab();
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
  /**
   * Whether the panel naming who from outside the firm may come is open. Offered to a member who
   * holds the key to host meetings, which is what sending, replacing and withdrawing a link ride on.
   */
  let guestsOpen = $state(false);
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

  /*
   * THE DOOR. The list a host reads is the LIVE one the room broadcasts to every socket holding a
   * grant; the read below fills the one gap that list has, and the writes are routes because
   * arrivals refused at a door somebody shut is a fact that outlives the room.
   */

  /** Whether the panel naming who is at the door is open. */
  let lobbyOpen = $state(false);
  /** The door's own refusal — a read or a decision — rendered in the panel's reserved band. */
  let lobbyRefusal = $state<Failure | null>(null);
  /**
   * The meeting and the grant the door was last read under.
   *
   * The read exists for one case and it is worth naming: a member named co-host at the twentieth
   * minute is sent the roster that says so and nothing about the people already standing outside,
   * because the room sends the waiting list as those people ARRIVE. Keyed on the grant as well as
   * the meeting, so a grant written later reads the door again rather than trusting a list that was
   * never sent to this socket.
   */
  let doorReadUnder = $state<string | null>(null);
  /** True once the hosts have been told somebody is outside, so they are told once and not per frame. */
  let arrivalAnnounced = $state(false);
  /** What the last batch at the door did not do, where it did not do all of it. */
  let doorShortfall = $state<string | null>(null);

  $effect(() => {
    const id = meetingId;
    if (id === "" || myRole === null || client.state !== "live") return;
    const key = `${id}:${myRole}`;
    if (doorReadUnder === key) return;
    doorReadUnder = key;
    void refreshLobby(id);
  });

  async function refreshLobby(id: string): Promise<void> {
    const outcome = await readMeetingLobby(id);
    if (outcome.kind !== "ok") {
      lobbyRefusal = outcome.failure;
      return;
    }
    lobbyRefusal = null;
    // Read through the same reader the frames are, so a guest at the door is marked as one and
    // carries the name their link was minted for whichever way the list arrived.
    client.noteWhoIsWaiting(readWaitingParticipants(outcome.value));
  }

  /*
   * SOMEBODY IS OUTSIDE, SAID ONCE AND NAMING NOBODY.
   *
   * A count on a control a host is not looking at is a person left standing at a door for ten
   * minutes, so the first arrival is raised where a host cannot miss it. It names nobody: who is at
   * the door is a list a host has not decided about yet, and a passer-by reading a colleague's
   * screen should not learn who was turned away.
   */
  $effect(() => {
    if (client.lobbyList.length === 0) {
      // An empty door arms it again, so a second arrival an hour later is announced as well.
      arrivalAnnounced = false;
      return;
    }
    if (myRole === null || arrivalAnnounced || lobbyOpen) return;
    arrivalAnnounced = true;
    toast("Somebody is waiting to be let in.");
  });

  /**
   * Let people in, or turn them away.
   *
   * The room tells every host what is left either way, so nothing here rebuilds the list. What is
   * kept is what the batch did NOT do: a host admitting five people into two free seats is told
   * which three did not get in, rather than watching three rows stay where they were.
   */
  function decideAtTheDoor(
    act: (participantIds: readonly string[]) => Promise<MeetingWrite<MeetingLobbyDecisions>>,
    participantIds: readonly string[],
    wanted: "admitted" | "denied",
  ): void {
    if (participantIds.length === 0) return;
    lobbyRefusal = null;
    doorShortfall = null;
    void act(participantIds).then((outcome) => {
      if (outcome.kind !== "ok") {
        lobbyRefusal = outcome.failure;
        return;
      }
      doorShortfall = doorDecisionStatement(outcome.value, wanted);
    });
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
      /*
       * The room rewrites its stored roles and broadcasts, so the badges and the menus follow from
       * the roster rather than from anything held here. The panel's own list is the exception: it
       * carries when each grant was written, which no frame does.
       *
       * IT IS RE-READ WHETHER OR NOT THE PANEL IS OPEN, and handing the meeting over is why. That
       * act is taken from a tile or a roster row, and it changes the ACTOR's own grant as well as
       * the other person's — the outgoing host keeps a co-host grant rather than losing everything
       * — so a panel that only re-read on its own opening would have shown a list in which the
       * person who pressed the control was still the host. A hosting write is a handful per
       * meeting; a read each is not a cost worth reasoning about.
       */
      void refreshHosts();
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
    // A press, and the arrival it causes runs after it is over: the tone's audio is woken now.
    client.unlockRecordingSounds();
    joinedMeetingId = null;
    // Asked for, so the departure that closed this screen's last stay stops standing in the way.
    departedMeetingId = null;
    joinFailure = null;
    // The door is read again on the way back in: this browser holds a list from a socket that is
    // gone, and the next welcome may be a stay that is waiting rather than a host's.
    doorReadUnder = null;
  }

  /*
   * Any press in the room wakes the recording tone's audio, for the browser that would not let the
   * arrival do it and for the phone that suspended it when a call came in. Only while this page holds
   * a stay: after leaving, a press opens no audio device for a meeting that is over.
   */
  function unlockSoundsOnPress(): void {
    if (joinedMeetingId !== null) client.unlockRecordingSounds();
  }

  function toggleSharing(): void {
    if (client.sharing) void client.stopSharing();
    else void client.shareScreen();
  }

  /*
   * WHAT IS BEING SAID IN THE ROOM.
   *
   * The transcript is the meeting's one stored content, so it is a route and a record rather than
   * anything the socket holds: a message is written by a POST, read back from its own cursor, and
   * taken back rather than deleted. The room will later relay a copy of a committed row so a
   * message arrives as it is said; the poll is what fills that gap today, and it is also what
   * catches a browser back up that missed the frame.
   */
  const chat = new MeetingChat(meetingChatSeams(() => meetingId));
  /*
   * The room relays a copy of every committed row, so a message arrives as it is said rather than
   * on the poll's next tick — and the poll stretches to its backstop pace the moment the first
   * frame lands. Wired here rather than inside the client because the transcript is the SCREEN's:
   * it is a route and a record, and the client is what is torn down when a connection drops.
   */
  client.relayMessagesTo(chat);
  /*
   * THE SIDE PANEL: chat, questions, polls and who is here, as four tabs beside the picture. It opens
   * on Chat; which tab is showing is also what decides whether a message, a question or a poll counts
   * as unseen.
   */
  let sideOpen = $state(true);
  let sideTab = $state<MeetingSideTab>("chat");
  /** Open the panel on one tab, or close it where that tab is already showing. */
  function toggleSide(tab: MeetingSideTab): void {
    if (sideOpen && sideTab === tab) {
      sideOpen = false;
      return;
    }
    sideTab = tab;
    sideOpen = true;
  }
  /** Whether the chat tab is showing, which is also what decides if a message counts as unread. */
  const chatOpen = $derived(sideOpen && sideTab === "chat");
  /** What is typed and not yet said. Held by the screen, so closing the panel does not lose it. */
  let chatDraft = $state("");

  /*
   * ASKING FOR THE FLOOR, AND WORKING THE QUEUE. A raised hand and a reaction are the two signals
   * this subsystem relays and never stores; what the screen adds is the place to put them.
   */

  /** Whether the host's queue is open. */
  let handsOpen = $state(false);

  /**
   * The queue, with the names and microphones the panel draws.
   *
   * The ORDER is the client's — a pure sort of the instants the room stamped — and what is added
   * here is only what the panel has to read: what somebody is called, and whether their microphone
   * is off, which is what decides whether Ask to Unmute is worth offering at all.
   */
  const raisedHands = $derived(
    client.raisedHands.flatMap((hand) => {
      const participant = client.participants.find(
        (one) => one.participantId === hand.participantId,
      );
      if (participant === undefined) return [];
      return [
        {
          participantId: hand.participantId,
          name: participantName(participant),
          muted: client.presenceOf(participant).muted,
        },
      ];
    }),
  );

  /*
   * Followed while this browser is IN the room and never before: a socket at the door has no stay
   * the route would accept a message from, and the transcript is a fact about a meeting this member
   * has not been let into yet.
   */
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

  /** Who said something, out of the roster this browser already holds. */
  function chatSenderName(message: MeetingMessage): string {
    const stay = client.participants.find(
      (one) => one.participantId === message.participantId,
    );
    if (stay !== undefined) return participantName(stay);
    // The stay has closed, or it belongs to a guest and was never on the roster. The member behind
    // it is the next honest answer, and where the roster does not hold them either there is nothing
    // left to say but that they have gone.
    const member =
      message.userId === null
        ? undefined
        : client.participants.find((one) => one.userId === message.userId);
    return member === undefined ? "Somebody who left" : participantName(member);
  }

  /**
   * Whether this reader may take a message back.
   *
   * Their own, or any of them while they are running the meeting: a host moderates the room and a
   * member takes back what they said. The route decides it again from the record, so this only
   * governs whether the control is offered.
   */
  function mayTakeBack(message: MeetingMessage): boolean {
    if (myRole !== null) return true;
    return message.userId !== null && message.userId === sessionPermissions.session?.user.id;
  }

  /** What a refused message reads as: the two refusals with words of their own, and the rest. */
  const chatWriteTitle = $derived.by(() => {
    if (refusedAs(chat.writeFailure, "meeting-message-too-long")) return "That Message Is Too Long";
    if (refusedAs(chat.writeFailure, "meeting-not-joined")) return "You Are Not in This Meeting";
    return "Nothing Was Said";
  });
  const chatWriteSentence = $derived.by(() => {
    if (refusedAs(chat.writeFailure, "meeting-message-too-long")) {
      return `A message holds ${String(MAX_MEETING_MESSAGE_LENGTH)} characters at most, and this one is longer.`;
    }
    if (refusedAs(chat.writeFailure, "meeting-not-joined")) {
      return "Your stay in this meeting has closed, so nothing can be said in it from here.";
    }
    return "That did not reach this meeting's record.";
  });

  /*
   * WHAT A HOST ASKS THE ROOM, AND WHAT THE ROOM ASKS A HOST.
   *
   * Both are records on the transcript's own terms: written by routes, read back by pages, and
   * relayed by the room as copies of committed rows so they arrive as they happen. The screen holds
   * them for the reason it holds the transcript — the client is what is torn down when a connection
   * drops, and a record does not go with it.
   */
  /** The member reading the room, which is what tells a poll they opened from one they are asked. */
  const viewerUserId = $derived(sessionPermissions.session?.user.id ?? null);
  const polls = new MeetingPolls(
    meetingPollSeams(() => meetingId),
    () => viewerUserId,
  );
  const questions = new MeetingQuestions(meetingQuestionSeams(() => meetingId));
  client.relayPollsTo(polls);
  client.relayQuestionsTo(questions);
  const pollsOpen = $derived(sideOpen && sideTab === "polls");
  // Questions are drawn in the chat, so the chat being open is the queue being seen.
  const questionsOpen = $derived(sideOpen && sideTab === "chat");
  /** What is typed and not yet asked. Held by the screen, so closing the panel does not lose it. */

  /**
   * The socket went away underneath a member still on the room's screen: the surface that says the
   * room stopped answering, with Rejoin beside it, and the grid and the controls still drawn.
   */
  const socketLost = $derived(
    client.state === "failed" && client.failureReason === SOCKET_CLOSED_REASON,
  );
  /**
   * Followed while this browser is IN the room and never before, for the transcript's reason: a
   * socket at the door has no stay the routes would accept an answer or a question from. Kept
   * through a lost socket, because the panels are still on screen, and let go on the way back in —
   * the join that follows reads them again whole.
   */
  const followingRecords = $derived(client.state === "live" || socketLost);

  /*
   * Read whole once as the member arrives; the room's frames carry both from there, so nothing reads
   * on a clock while the socket is up.
   */
  $effect(() => {
    if (!followingRecords) return;
    polls.start();
    questions.start();
    return () => {
      polls.stop();
      questions.stop();
    };
  });

  /*
   * While the socket is down nothing relayed arrives, so each record reads on its slow backstop until
   * it is back — and reads once on the way, which is what catches it up on the frames it missed.
   */
  $effect(() => {
    if (!followingRecords) return;
    if (socketLost) {
      polls.noteSocketLost();
      questions.noteSocketLost();
    } else {
      polls.noteSocketRestored();
      questions.noteSocketRestored();
    }
  });

  $effect(() => {
    if (pollsOpen) polls.noteOpened();
    else polls.noteClosed();
  });

  $effect(() => {
    if (questionsOpen) questions.noteOpened();
  });

  /** True once the member has been told a poll opened, so a burst of polls is said once. */
  let pollAnnounced = $state(false);

  /*
   * A POLL IS OPEN, SAID ONCE AND NAMING NOTHING BUT THE ACT, on the lobby toast's precedent: a count
   * on a control a member is not looking at is a poll nobody answers. Opening the panel is what
   * re-arms it, because then the member has seen what there was to see.
   */
  $effect(() => {
    if (polls.openedUnseen === 0) {
      pollAnnounced = false;
      return;
    }
    if (pollAnnounced || pollsOpen) return;
    pollAnnounced = true;
    toast("A poll is open.");
  });

  /** Who gave an answer, out of the roster, and the member behind the stay where it has closed. */
  function nameOfStay(participantId: string, userId: string | null): string {
    const stay = client.participants.find((one) => one.participantId === participantId);
    if (stay !== undefined) return participantName(stay);
    const member =
      userId === null ? undefined : client.participants.find((one) => one.userId === userId);
    return member === undefined ? "Somebody who left" : participantName(member);
  }

  /**
   * Whether this reader asked a question, which is what offers them Redact on their own row: the
   * stay they are in now, or the member behind it where they asked from an earlier stay.
   */
  function askedByMe(question: MeetingQuestionView): boolean {
    if (question.participantId === client.participantId) return true;
    return question.userId !== null && question.userId === sessionPermissions.session?.user.id;
  }

  /** What a refused poll act reads as: the refusals with words of their own, and the rest. */
  const pollWriteTitle = $derived.by(() => {
    if (refusedAs(polls.writeFailure, "meeting-poll-closed")) return "That Poll Is Closed";
    if (refusedAs(polls.writeFailure, "meeting-poll-already-answered")) {
      return "You Have Answered This Poll";
    }
    if (refusedAs(polls.writeFailure, "meeting-not-host")) return "You Are Not Hosting This Meeting";
    if (refusedAs(polls.writeFailure, "meeting-not-joined")) return "You Are Not in This Meeting";
    return "Nothing Changed";
  });
  const pollWriteSentence = $derived.by(() => {
    if (refusedAs(polls.writeFailure, "meeting-poll-closed")) {
      return "A host closed this poll, so it takes no more answers.";
    }
    if (refusedAs(polls.writeFailure, "meeting-poll-already-answered")) {
      return "An answer cannot be changed once it is given.";
    }
    if (refusedAs(polls.writeFailure, "meeting-not-host")) {
      return "Only somebody hosting this meeting can open or close a poll.";
    }
    if (refusedAs(polls.writeFailure, "meeting-not-joined")) {
      return "Your stay in this meeting has closed, so nothing can be answered from here.";
    }
    return "That did not reach this meeting's record.";
  });

  const questionWriteTitle = $derived.by(() => {
    if (refusedAs(questions.writeFailure, "meeting-question-too-long")) {
      return "That Question Is Too Long";
    }
    if (refusedAs(questions.writeFailure, "meeting-question-limit-reached")) {
      return "This Meeting Has Too Many Questions";
    }
    if (refusedAs(questions.writeFailure, "meeting-not-joined")) {
      return "You Are Not in This Meeting";
    }
    return "Nothing Changed";
  });
  const questionWriteSentence = $derived.by(() => {
    if (refusedAs(questions.writeFailure, "meeting-question-too-long")) {
      return `A question holds ${String(MAX_MEETING_QUESTION_LENGTH)} characters at most, and this one is longer.`;
    }
    if (refusedAs(questions.writeFailure, "meeting-question-limit-reached")) {
      return "No more questions can be asked in this meeting.";
    }
    if (refusedAs(questions.writeFailure, "meeting-not-joined")) {
      return "Your stay in this meeting has closed, so nothing can be asked from here.";
    }
    return "That did not reach this meeting's record.";
  });

  /*
   * RECORDING THE MEETING. Record and Stop are routes the client reaches through the screen's address;
   * whether a recording is running, and the announcement of it, come off the room's frames alone.
   */
  client.recordThrough(meetingRecordingRoutes(() => meetingId));

  /** Whether the confirmation before a recording starts is open. */
  let recordConfirming = $state(false);

  /**
   * Who may press Record: the right to record AND a grant on this room. Who may press Stop: anybody
   * holding a grant, because somebody running the room can already end the meeting and ending it
   * stops the recording. Both are read off the roster, so a grant withdrawn mid-meeting takes the
   * control with it on the next roster.
   */
  const mayStartRecording = $derived(canRecord && myRole !== null);
  const mayStopRecording = $derived(myRole !== null);

  /**
   * Why this meeting cannot be recorded, where it cannot: a recording is kept on a matter and a firm
   * event has none, or the firm has not switched recording on. Said in place of the control rather
   * than discovered by pressing it; the route's own refusal still says the second where the summary
   * in hand is older than the setting.
   */
  const recordingUnavailable = $derived.by(() => {
    if (summary === null) return null;
    if (summary.eventKind === "firm") {
      return summary.personalRoomSession
        ? "Move this meeting to a matter to record it."
        : "A meeting on a firm event cannot be recorded.";
    }
    if (!recordingIsConfigured(summary)) return "Recording is not switched on for this firm yet.";
    return null;
  });

  /**
   * What a refused start or stop reads as, in the words of the route's own problem type, kept apart
   * by act: a start is refused inside its confirmation, and a stop where the room's other refusals
   * are said.
   */
  const recordingWriteRefusal = $derived.by(() => {
    const failure = client.recording.writeFailure;
    const act = client.recording.refusedAct;
    if (failure === null || act === null) return null;
    return { act, failure, ...recordingRefusal(failure, act) };
  });

  /** Whether the panel listing what has been recorded is open. */
  let recordingsOpen = $state(false);

  /*
   * A personal-room meeting opens on its owner's own calendar, and is moved onto a matter once
   * somebody says what it is about — during the meeting or after it, so it is offered whether or
   * not the meeting is over. The server holds who may: the room's owner or a host of this meeting.
   */
  const mayMoveToMatter = $derived(
    summary !== null && summary.personalRoomSession && summary.eventKind === "firm" && canHost,
  );
  let moveOpen = $state(false);

  /**
   * WHO WAS TOLD, AND WHEN: the consent record of one recording. A host's read, opened from a row of
   * the list, because it names everybody who was in the room, guests included.
   */
  let noticesFor = $state<MeetingRecordingView | null>(null);
  let noticesOpen = $state(false);
  let noticeRows = $state<readonly MeetingRecordingNoticeView[]>([]);
  let noticesCursor = $state<string | null>(null);
  let noticesReading = $state(false);
  let noticesFailure = $state<Failure | null>(null);

  async function readNotices(recording: MeetingRecordingView, cursor: string | null): Promise<void> {
    noticesReading = true;
    const outcome = await readMeetingRecordingNotices(meetingId, recording.id, cursor);
    noticesReading = false;
    if (outcome.kind !== "ok") {
      noticesFailure = outcome.failure;
      return;
    }
    noticesFailure = null;
    noticeRows = cursor === null ? outcome.value.notices : [...noticeRows, ...outcome.value.notices];
    noticesCursor = outcome.value.nextCursor;
  }

  function openNotices(recording: MeetingRecordingView): void {
    if (!canHost) return;
    noticesFor = recording;
    noticeRows = [];
    noticesCursor = null;
    noticesOpen = true;
    void readNotices(recording, null);
  }

  /** Why somebody was told, in the record's own three occasions. */
  function noticeReasonWord(reason: MeetingRecordingNoticeView["reason"]): string {
    switch (reason) {
      case "start":
        return "When it started";
      case "arrival":
        return "On arriving";
      case "stop":
        return "When it stopped";
    }
  }

  const noticesGrid = DataTable.createDataTableGrid<MeetingRecordingNoticeView>({
    columns: () => [
      {
        id: "who",
        label: "Who",
        type: "text",
        anchored: true,
        filter: "text",
        value: (row) =>
          row.participantKind === "guest"
            ? guestAttendeeLabel(row.displayName, null)
            : row.displayName,
      },
      {
        id: "why",
        label: "Told",
        type: "text",
        filter: "text",
        value: (row) => noticeReasonWord(row.reason),
      },
      {
        id: "when",
        label: "When",
        type: "date",
        value: (row) => row.deliveredAt,
        text: (row) => formatInstant(row.deliveredAt),
      },
    ],
    rows: () => noticeRows,
    rowKey: (row) => row.id,
    initialSort: untrack(() => ({ columnId: "when", direction: "ascending" as const })),
    itemNoun: { singular: "notice", plural: "notices" },
  });

  /** The recording a notices panel is about, named by when it started. */
  const noticesSubject = $derived<RecordSubject>(
    noticesFor === null || summary === null
      ? {}
      : { facts: [summary.title, formatInstant(noticesFor.startedAt)] },
  );

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

  /**
   * The day and time, as one line for a surface that has no header band to spread them across.
   *
   * Somebody following a link an hour early is the case it exists for: standing at a door with no
   * idea whether anybody is behind it yet is the one thing the waiting screen can answer for them.
   */
  const whenLine = $derived.by(() => {
    if (summary === null) return null;
    const day = formatDate(summary.startsOn);
    return startsAt === null ? day : `${day} at ${startsAt} ${zoneCode}`.trim();
  });

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
   * The view changing shape goes into the diagnostics, so a flash a member reports can be lined up
   * against what the screen did at that moment. Words only, never whose picture it was.
   */
  let lastView: { large: string | null; layout: string; share: boolean; mirror: boolean } | null =
    null;
  $effect(() => {
    const view = {
      large: spotlight?.key ?? null,
      layout: viewPreference.current.layout,
      share: sharedScreen !== null,
      mirror: viewPreference.current.mirrorSelf,
    };
    const before = lastView;
    lastView = view;
    if (before === null) return;
    const changes = [
      before.layout === view.layout ? null : `layout ${view.layout}`,
      before.share === view.share ? null : view.share ? "a screen share began" : "the share ended",
      before.mirror === view.mirror ? null : view.mirror ? "mirror on" : "mirror off",
      before.large === view.large || before.layout !== view.layout ? null : "speaker changed",
    ].filter((change) => change !== null);
    if (changes.length > 0) client.diagnostics.note({ kind: "view", detail: changes.join(", ") });
  });

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
  /*
   * A host turned this member away at the door — the twin of being removed, by the two same routes:
   * the socket's own refusal while they stood there, and the join's 409 for somebody following a
   * link back to a meeting they were denied. Barred entry is one rule with two labels, so there is
   * no way back in from either, and only the sentence differs.
   */
  const denied = $derived(
    client.failureReason === DENIED_REASON || refusedAs(joinFailure, "meeting-not-admitted"),
  );
  /** Standing at the door: not in the room, and nothing captured until a host says so. */
  const atTheDoor = $derived(client.state === "waiting");
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
   * The meeting is end-to-end encrypted and this browser cannot seal or open its frames. No Rejoin:
   * the same browser would meet the same answer, so it says what would work instead.
   */
  const cannotEncrypt = $derived(client.failureReason === ENCRYPTION_UNSUPPORTED_REASON);
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

<!--
  What is being said, beside what is being sent. It is passed to the band as a snippet rather than
  rendered here, for the reason the connection control is: the band owns where a control sits, and
  the control owns what it says and what it opens.
-->
{#snippet chatToggle()}
  <Button
    variant={chatOpen ? "primary" : "secondary"}
    aria-pressed={chatOpen}
    onclick={() => toggleSide("chat")}
  >
    <MessageSquare class="size-16" aria-hidden="true" />
    Chat
    {#if chat.unread > 0}
      <Badge variant="primary">{chat.unread}</Badge>
    {/if}
  </Button>
{/snippet}

{#snippet chatControl()}
  <MeetingChatPanel
    inline
    bind:draft={chatDraft}
    messages={chat.messages}
    unread={chat.unread}
    loading={chat.reading}
    failed={chat.readFailure !== null && chat.messages.length === 0}
    sending={chat.sending}
    nameOf={chatSenderName}
    canTakeBack={mayTakeBack}
    onSend={(body) => chat.send(body)}
    onTakeBack={(messageId) => void chat.redact(messageId)}
    questions={questions.queue}
    hosting={myRole !== null}
    asking={questions.asking}
    upvoting={questions.upvoting}
    questionNameOf={(question) => nameOfStay(question.participantId, question.userId)}
    isMyQuestion={askedByMe}
    onAsk={(body) => questions.ask(body)}
    onToggleUpvote={(questionId) => void questions.toggleUpvote(questionId)}
    onMarkAnswered={(questionId, answered) => void questions.markAnswered(questionId, answered)}
    onRedactQuestion={(questionId) => void questions.redact(questionId)}
  >
    {#snippet questionFailure()}
      {#if questions.writeFailure !== null}
        <FailureNotice
          failure={questions.writeFailure}
          subject="This meeting"
          title={questionWriteTitle}
          fallback={questionWriteSentence}
          whenSilent="Nothing answered, so nothing changed in this meeting's questions."
        />
      {/if}
    {/snippet}

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
          title={chatWriteTitle}
          fallback={chatWriteSentence}
          whenSilent="Nothing answered, so nothing was said in this meeting."
        />
      {/if}
    {/snippet}
  </MeetingChatPanel>
{/snippet}

<!--
  The six, behind one control in the band. Passed as a snippet for the reason the chat and
  connection controls are: the band owns where a control sits, the control owns what it offers.
-->
{#snippet reactionsControl()}
  <MeetingReactions onReact={(name) => client.react(name)} />
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

<!-- What has been recorded in this room, beside Guests and for the same reason: it is about the
     meeting's record rather than the room this second, and it is read after the meeting as often as
     during it. Only a meeting on a matter can be recorded, so only one offers the list. -->
{#snippet headerActions()}
  {#if !over}
    <!-- Who else should be here. The firm's link for a colleague, and the guest list for somebody
         outside it, in one place a member looks for both. -->
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={buttonClasses({ variant: "secondary", size: "default" })}>
        <Share2 class="size-16" aria-hidden="true" />
        Share
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item onSelect={() => void copyMeetingLink()}>
          <Link class="size-16 shrink-0" aria-hidden="true" />
          Copy Link for the Firm
        </DropdownMenu.Item>
        {#if canHost}
          <DropdownMenu.Item onSelect={() => (guestsOpen = true)}>
            <UsersRound class="size-16 shrink-0" aria-hidden="true" />
            Invite Guests
          </DropdownMenu.Item>
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}
  {#if mayMoveToMatter}
    <Button variant="secondary" onclick={() => (moveOpen = true)}>
      <FolderInput class="size-16" aria-hidden="true" />
      Move to a Matter
    </Button>
  {/if}
  {#if summary?.eventKind === "matter"}
    <Button variant="secondary" onclick={() => (recordingsOpen = true)}>
      <Disc class="size-16" aria-hidden="true" />
      Recordings
    </Button>
  {/if}
{/snippet}

<svelte:head><title>{title} · Magna Carta</title></svelte:head>

<svelte:window
  onpagehide={departOnUnload}
  onbeforeunload={departOnUnload}
  onclick={unlockSoundsOnPress}
  onkeydown={unlockSoundsOnPress}
/>

<div class="flex h-full min-h-0 flex-col gap-16 p-16">
  <ScreenHeader
    {title}
    back="meetings"
    actions={summary !== null && (summary.eventKind === "matter" || mayMoveToMatter || !over)
      ? headerActions
      : undefined}
  >
    {#snippet meta()}
      {#if summary !== null}
        <span>{formatDate(summary.startsOn)}</span>
        {#if startsAt !== null}
          <span>{endsAt === null ? startsAt : `${startsAt} to ${endsAt}`} {zoneCode}</span>
        {/if}
        <span>{kindWord}</span>
        {#if client.recording.running !== null}
          <!-- THE MARK, for exactly as long as the room says the recording runs: lit by the room's
               announcement to everybody and cleared by its announcement of the stop, never by
               anything pressed on this screen. -->
          <RecordingMark />
        {/if}
        {#if client.roomState.locked}
          <!-- On the line that already carries the day and the head count, because whether the
               door is shut is a fact about the room rather than an act anybody here can take. -->
          <span>Locked</span>
        {/if}
        <span>{summary.liveCount === 1 ? "1 in the room" : `${summary.liveCount} in the room`}</span>
        <!-- ABOVE THE THRESHOLD THE ROOM SENDS COUNTS RATHER THAN BUBBLES, and the counts are what
             is true at that size: a bubble on the right face is a promise a sixteen-tile gallery
             cannot keep for three hundred people. It draws nothing at all when nothing has
             arrived, and it fades on the same dwell a bubble does. -->
        <MeetingReactionCounts counts={client.reactions.counts} />
      {/if}
    {/snippet}
  </ScreenHeader>

  <!-- WHAT A READER WHO CANNOT SEE THE BANNER IS TOLD, assertively: that a recording started, that
       one was running as they arrived, or that it stopped. Always mounted, so the region exists
       before its words change, which is what makes a screen reader announce them. -->
  <div aria-live="assertive" aria-atomic="true" class="sr-only">
    {client.recording.announcement}
  </div>

  <!-- The banner across the header, until the member dismisses it; the mark beside the title is
       what stays. -->
  <RecordingNotice recording={client.recording} />

  {#if canHost && summary !== null}
    <!-- Beside the header whose control opens it, rather than inside the room: a host who has not
         walked in yet, or whose join was refused, can still see who has a link. -->
    <MeetingGuestsPanel
      bind:open={guestsOpen}
      subject={endSubject}
      {meetingId}
      eventKind={summary.eventKind}
      eventId={summary.eventId}
    />
  {/if}

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
      <EmptyState title="Meetings Are Not Connected">
        The video service that carries meetings is not connected to this site yet, so a room cannot
        be opened here.
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
    {:else if denied}
      <EmptyState title="You Were Not Let Into This Meeting">
        {DENIED_STATEMENT}
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
    {:else if atTheDoor}
      <!-- NOT THE ROOM WITH THINGS MISSING. A waiting socket holds no roster and this browser has
           captured nothing, so there is no grid to page, no rail to read and no control bar to
           draw — the one act somebody at a door has is going away again. -->
      <MeetingLobbyWait
        {title}
        when={whenLine}
        place={client.waiting}
        {leaving}
        onLeave={() => void leave()}
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
      {:else if cannotEncrypt}
        <div class="flex flex-col items-start gap-8">
          <Alert.Root variant="warning">
            <Alert.Title>This Browser Cannot Join an Encrypted Meeting</Alert.Title>
            <Alert.Description>
              This meeting's pictures and sound are sealed end to end, and this browser cannot seal
              or open them. Join from a current version of Chrome, Edge, Firefox or Safari.
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

      <!-- A stop the room refused. Stop asks nothing first, so its answer has no panel to stand in
           and is said here, where the other things the room did not do are said. -->
      {#if recordingWriteRefusal !== null && recordingWriteRefusal.act === "stop"}
        <FailureNotice
          failure={recordingWriteRefusal.failure}
          subject="This meeting"
          title={recordingWriteRefusal.title}
          fallback={recordingWriteRefusal.sentence}
          whenSilent="Nothing answered, so the recording did not stop."
        />
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
            mirrorSelf={viewPreference.current.mirrorSelf}
            onPictureAttached={(where) =>
              client.diagnostics.note({ kind: "picture", detail: where })}
          />
        </div>
        {#if sideOpen}
          <div class="min-h-0 w-xs shrink-0">
            <MeetingSidePanel
              bind:tab={sideTab}
              chatUnread={chat.unread}
              questionsWaiting={questions.waiting}
              pollsWaiting={polls.waitingForAnswer}
              peopleCount={client.participants.length}
              onClose={() => (sideOpen = false)}
              chat={chatControl}
              polls={pollsTab}
            >
              {#snippet people()}
          <MeetingRoster
                  participants={client.participants}
                  ownParticipantId={client.participantId}
                  presenceOf={(participant) => client.presenceOf(participant)}
                  qualityOf={(participant) => client.qualityOf(participant.participantId)}
                  spotlightedParticipantId={client.roomState.spotlight?.participantId ?? null}
                  hostMenu={myRole === null ? undefined : rowMenu}
                />
              {/snippet}
            </MeetingSidePanel>
          </div>
        {/if}
      </div>

      <!-- WHAT A READER WHO CANNOT SEE THE MARKS IS TOLD, politely and once. A raised hand is
           announced at every room size, because it is a request for the floor; a reaction is
           announced only where the room named who threw it, and the coalesced counts strip is not
           announced at all — a stream of changing numbers read out once a second is noise. -->
      <div aria-live="polite" class="sr-only">{client.reactions.announcement}</div>

      <MeetingControls
        microphoneOn={client.microphoneOn}
        cameraOn={client.cameraOn}
        sharing={client.sharing}
        speakerView={client.speakerView}
        medium={client.medium}
        canEnd={canHost}
        hosting={myRole !== null}
        handRaised={client.reactions.hand}
        raisedHandCount={client.raisedHands.length}
        locked={client.roomState.locked}
        lobby={client.roomState.lobby}
        waitingCount={client.lobbyList.length}
        spotlighted={client.roomState.spotlight !== null}
        subtitle={endSubject}
        appliedEffects={client.appliedEffects}
        effectSettings={client.effectSettings}
        pollsWaiting={polls.waitingForAnswer}
        questionsWaiting={questions.waiting}
        recording={client.recording.running !== null}
        {mayStartRecording}
        {mayStopRecording}
        {recordingUnavailable}
        stoppingRecording={client.recording.stopping}
        onRecord={() => (recordConfirming = true)}
        onStopRecording={() => void client.stopRecording()}
        onChangeEffects={changeEffects}
        onChooseBackgroundImage={(file) => void chooseBackgroundImage(file)}
        onOpenPolls={() => toggleSide("polls")}
        onOpenPeople={() => toggleSide("people")}
        sideTab={sideOpen ? sideTab : null}
        peopleCount={client.participants.length}
        onToggleMicrophone={() => client.toggleMicrophone()}
        onToggleCamera={() => client.toggleCamera()}
        onToggleSharing={toggleSharing}
        onToggleHand={() => (client.reactions.hand ? client.lowerHand() : client.raiseHand())}
        onOpenHands={() => (handsOpen = true)}
        onLowerAllHands={() => client.lowerHands(null)}
        onToggleSpeakerView={toggleSpeakerView}
        mirrorSelf={viewPreference.current.mirrorSelf}
        onMirrorSelf={(mirrorSelf) => viewPreference.set({ ...viewPreference.current, mirrorSelf })}
        onMuteAll={() => client.muteAll()}
        onSetLocked={(wanted) => void hostingWrite(() => setMeetingLocked(meetingId, wanted))}
        onSetLobby={(wanted: MeetingLobbyMode) =>
          void hostingWrite(() => setMeetingLobby(meetingId, wanted))}
        onOpenLobby={() => (lobbyOpen = true)}
        onClearSpotlight={() => client.spotlight(null)}
        onOpenHosts={() => (hostsOpen = true)}
        onLeave={() => void leave()}
        onEnd={end}
        chat={chatToggle}
        reactions={reactionsControl}
      >
        {#snippet connection()}
          <MeetingConnectionPanel
            {uplink}
            participants={connectionRoom}
            events={wireEvents}
            onCopy={() => void copyDiagnostics()}
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

      <!-- ASKED FIRST, because the act is the one in this room that outlives it: a recording is kept
           on the matter, and everybody in the room is told the instant it starts. The panel says so
           before the press rather than after it. -->
      {#if mayStartRecording}
        <ActionDialog
          bind:open={recordConfirming}
          kind="confirm"
          heading="Record This Meeting"
          subtitle={endSubject}
          commitLabel="Record"
          commitBusyLabel="Starting"
          unsavedChanges={false}
          onCommit={() => client.startRecording()}
        >
          {#snippet notice()}
            {#if recordingWriteRefusal !== null && recordingWriteRefusal.act === "start"}
              <FailureNotice
                failure={recordingWriteRefusal.failure}
                subject="This meeting"
                title={recordingWriteRefusal.title}
                fallback={recordingWriteRefusal.sentence}
                whenSilent="Nothing answered, so the recording did not start."
              />
            {/if}
          {/snippet}

          {#snippet fields()}
            <p class="text-sm">
              Everybody in the room, guests included, is told at once that the meeting is being
              recorded, and so is anybody who joins while it runs. The recording is kept on the
              matter.
            </p>
          {/snippet}
        </ActionDialog>
      {/if}

      <!-- The queue, in the order the hands went up. Opened from a control that is absent for
           everybody who is not running the meeting: lowering somebody else's hand is a host act,
           and everybody lowers their own from the band's own toggle. -->
      <MeetingHandsPanel
        bind:open={handsOpen}
        subject={endSubject}
        hands={raisedHands}
        onAskToUnmute={(participantId) => client.askToUnmute(participantId)}
        onLowerHand={(participantId) => client.lowerHands(participantId)}
        onLowerAll={() => client.lowerHands(null)}
      />

      <!-- What a host has asked the room. Everybody answers from here, and a host asks from the top
           of the same panel. -->
      {#snippet pollsTab()}
      <MeetingPollsPanel
        inline
        subject={endSubject}
        polls={polls.polls}
        hosting={myRole !== null}
        {viewerUserId}
        membersInRoom={membersWhoCanAnswer(client.participants)}
        loading={polls.reading}
        failed={polls.readFailure !== null && polls.polls.length === 0}
        opening={polls.opening}
        answering={polls.answering}
        onOpenPoll={(draft) => polls.open(draft)}
        onAnswer={(pollId, optionIds) => polls.answer(pollId, optionIds)}
        onClosePoll={(pollId) => polls.close(pollId)}
        onReadAnswers={(pollId, cursor) => polls.whoAnswered(pollId, cursor)}
        nameOfAnswer={(answer) => nameOfStay(answer.participantId, answer.userId)}
      >
        {#snippet readFailure()}
          {#if polls.readFailure !== null}
            <FailureNotice
              failure={polls.readFailure}
              subject="This meeting"
              title="Nothing Could Be Read"
              fallback="This meeting's polls could not be read."
              whenSilent="Nothing answered. This meeting's polls could not be read."
              onRetry={() => void polls.refresh()}
            />
          {/if}
        {/snippet}

        {#snippet writeFailure()}
          {#if polls.writeFailure !== null}
            <FailureNotice
              failure={polls.writeFailure}
              subject="This meeting"
              title={pollWriteTitle}
              fallback={pollWriteSentence}
              whenSilent="Nothing answered, so nothing changed in this meeting's polls."
            />
          {/if}
        {/snippet}
      </MeetingPollsPanel>
      {/snippet}


      <!-- Who is at the door. Opened from a control that is absent for everybody who is not running
           the meeting, and it would have nothing to draw for them either: the room sends the list
           to the sockets holding a grant and to nobody else. -->
      <MeetingLobbyPanel
        bind:open={lobbyOpen}
        subject={endSubject}
        waiting={client.lobbyList}
        onAdmit={(participantIds) =>
          decideAtTheDoor(
            (ids) => admitToMeetingLobby(meetingId, ids),
            participantIds,
            "admitted",
          )}
        onDeny={(participantIds) =>
          decideAtTheDoor((ids) => denyFromMeetingLobby(meetingId, ids), participantIds, "denied")}
      >
        {#snippet writeFailure()}
          {#if lobbyRefusal !== null}
            <FailureNotice
              failure={lobbyRefusal}
              subject="This meeting"
              title="Nobody Moved"
              fallback="Nothing changed at the door."
              whenSilent="Nothing answered, so nothing changed at the door."
              onRetry={() => void refreshLobby(meetingId)}
            />
          {:else if doorShortfall !== null}
            <!-- A batch that half-landed. Not a failure and not dressed as one: the request was
                 served, and what it says is which of the people named did not move. -->
            <Alert.Root variant="info">
              <Alert.Title>Not Everybody Moved</Alert.Title>
              <Alert.Description>{doorShortfall}</Alert.Description>
            </Alert.Root>
          {/if}
        {/snippet}
      </MeetingLobbyPanel>

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

  {#if summary !== null && summary.eventKind === "matter"}
    <!-- What has been recorded, beside the header control that opens it rather than inside the
         room: a meeting that ended last week still has its recordings, and so does a room this
         member could not get into. -->
    <RecordingList
      bind:open={recordingsOpen}
      {meetingId}
      subject={endSubject}
      announced={client.recording.running}
      insideRoom
      onWhoWasTold={canHost ? openNotices : undefined}
    />

    {#if canHost}
      <!-- Who was told about one recording, and when: the consent record. Opened from a row of the
           list, and only for a member holding the key to host meetings, because it names everybody
           who was in the room. -->
      <ActionDialog
        bind:open={noticesOpen}
        kind="reading"
        heading="Who Was Told"
        subtitle={noticesSubject}
        width="wide"
      >
        {#snippet fields()}
          {#if noticesFailure !== null && noticeRows.length === 0}
            <FailureNotice
              failure={noticesFailure}
              subject="This recording"
              fallback="Who was told about this recording could not be read."
              whenSilent="Nothing answered. Who was told about this recording could not be read."
              onRetry={() => (noticesFor === null ? undefined : void readNotices(noticesFor, null))}
            />
          {:else}
            <div class="flex flex-col gap-8">
              <DataTable.Grid
                grid={noticesGrid}
                caption="Who was told about this recording, and when"
                loading={noticesReading && noticeRows.length === 0}
                placeholderCount={3}
              />
              <DataTable.GridFooter grid={noticesGrid}>
                {#snippet end()}
                  <DataTable.LoadMore
                    noun="notices"
                    more={noticesCursor !== null}
                    loading={noticesReading && noticeRows.length > 0}
                    onLoad={() =>
                      noticesFor === null ? undefined : void readNotices(noticesFor, noticesCursor)}
                  />
                {/snippet}
              </DataTable.GridFooter>
            </div>
          {/if}
        {/snippet}
      </ActionDialog>
    {/if}
  {/if}
</div>

{#if mayMoveToMatter && summary !== null}
  <MoveToMatterDialog
    bind:open={moveOpen}
    {meetingId}
    subject={{ facts: [summary.title] }}
    onMoved={() => void summaryRead.refetch()}
  />
{/if}
