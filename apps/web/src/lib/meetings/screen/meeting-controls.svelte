<script lang="ts">
  /*
   * The control bar: what a member does while they are in the room.
   *
   * EACH TOGGLE IS ONE CONTROL, NOT TWO. Muting and unmuting are the same act read from either
   * side, so the control holds its place and changes its glyph and its fill — the house pattern for
   * a two-state control (a filled secondary while it is sending, quiet while it is not), with
   * `aria-pressed` carrying the state to a reader who cannot see the fill. A pair of buttons would
   * put the one you want in a different place depending on what you last did.
   *
   * THE BAND NAMES ITS CONTROLS ON HOVER, one name each. These are glyphs in a chrome band, which is
   * exactly the case the product answers with the design system's Tooltip rather than a native
   * title, so the delay, the placement and the look are the same as every other hover in the app.
   *
   * A CALL CARRIES FEWER CONTROLS, NOT DISABLED ONES. There is no camera in a call and no screen to
   * share into it, so those two are absent rather than greyed: a disabled control says "this could
   * happen here and does not", and neither could ever happen in a call.
   *
   * LEAVING AND ENDING ARE DIFFERENT ACTS AND LOOK IT. Leaving takes this member out of the room;
   * ending closes it for everybody and is the host's alone, so it is asked for behind the one panel
   * the product asks acts in. Only one of the two wears the loud register, because a band with two
   * red controls tells a reader nothing about which one is the dangerous one.
   *
   * THE EFFECTS PANEL DRAWS NO CONTROL THAT CANNOT ACT. What a browser can do to somebody's sound
   * and picture is read off their own tracks, so the panel is built from that reading: a background
   * the product may blur is offered as two rows; one the machine decides, or one this browser cannot
   * blur at all, is a single line saying so rather than a disabled toggle promising something that
   * will not happen here. It is a POPOVER, like the connection and chat panels beside it, rather than
   * a menu: what it holds is a switch, two choice rows and a failure band, none of which is a menu
   * item, and a menu role over them would announce a list of commands that is not there.
   *
   * THE POLLS AND Q&A CONTROLS CARRY THEIR OWN COUNTS, on the lobby's argument: a poll nobody has
   * answered and a question nobody has taken are both things a member learns about by SEEING a number
   * on a control they were not looking at, never by opening a panel to check.
   *
   * RECORD AND STOP ARE ONE CONTROL, read from either side like every toggle here, and it is drawn
   * only for somebody who could press it: a member holding the right to record AND a grant on this
   * room may start one, and anybody holding a grant may stop one, because a host can already end the
   * meeting and ending it stops the recording. Everybody else sees the mark in the header and no
   * control, on this band's own rule that a control nobody may use is absent rather than disabled.
   * The one disabled state is a meeting that can never be recorded — a firm event has no matter to
   * keep a recording on — and it says so where the control would be.
   */
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import MessageCircleQuestionMark from "@lucide/svelte/icons/message-circle-question-mark";
  import Vote from "@lucide/svelte/icons/vote";
  import DoorClosed from "@lucide/svelte/icons/door-closed";
  import DoorOpen from "@lucide/svelte/icons/door-open";
  import Focus from "@lucide/svelte/icons/focus";
  import Hand from "@lucide/svelte/icons/hand";
  import Lock from "@lucide/svelte/icons/lock";
  import LockOpen from "@lucide/svelte/icons/lock-open";
  import Mic from "@lucide/svelte/icons/mic";
  import Circle from "@lucide/svelte/icons/circle";
  import CircleStop from "@lucide/svelte/icons/circle-stop";
  import Presentation from "@lucide/svelte/icons/presentation";
  import MicOff from "@lucide/svelte/icons/mic-off";
  import PhoneOff from "@lucide/svelte/icons/phone-off";
  import ScreenShare from "@lucide/svelte/icons/screen-share";
  import ScreenShareOff from "@lucide/svelte/icons/screen-share-off";
  import ShieldUser from "@lucide/svelte/icons/shield-user";
  import Square from "@lucide/svelte/icons/square";
  import Video from "@lucide/svelte/icons/video";
  import VideoOff from "@lucide/svelte/icons/video-off";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import ChoiceRow from "@magna-carta/design-system/choice-row";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import FailureBand from "@magna-carta/design-system/failure-band";
  import FileInput from "@magna-carta/design-system/file-input";
  import Label from "@magna-carta/design-system/label";
  import * as Popover from "@magna-carta/design-system/popover";
  import Switch from "@magna-carta/design-system/switch";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { MeetingLobbyMode, MeetingMedium } from "@magna-carta/meeting-protocol/types";
  import {
    audioTreatmentStatement,
    BLUR_UNAVAILABLE_STATEMENT,
    DEFAULT_EFFECT_SETTINGS,
    NOISE_REMOVAL_DESCRIPTION,
    NOISE_REMOVAL_ON_STATEMENT,
    platformBlurStatement,
    type AppliedEffects,
    type EffectsChange,
    type MediaEffectSettings,
  } from "$lib/meetings/client/media-effects.ts";
  import type { Snippet } from "svelte";

  let {
    microphoneOn,
    cameraOn,
    sharing,
    speakerView = false,
    medium = "video",
    canEnd = false,
    hosting = false,
    handRaised = false,
    raisedHandCount = 0,
    locked = false,
    lobby = "off",
    waitingCount = 0,
    spotlighted = false,
    subtitle = {},
    appliedEffects = null,
    effectSettings = DEFAULT_EFFECT_SETTINGS,
    pollsWaiting = 0,
    questionsWaiting = 0,
    recording = false,
    mayStartRecording = false,
    mayStopRecording = false,
    recordingUnavailable = null,
    stoppingRecording = false,
    onRecord,
    onStopRecording,
    onToggleMicrophone,
    onToggleCamera,
    onToggleSharing,
    onToggleHand,
    onOpenHands,
    onLowerAllHands,
    onToggleSpeakerView,
    onMuteAll,
    onSetLocked,
    onSetLobby,
    onOpenLobby,
    onClearSpotlight,
    onOpenHosts,
    onChangeEffects,
    onChooseBackgroundImage,
    onOpenPolls,
    onOpenQuestions,
    onLeave,
    onEnd,
    connection,
    chat,
    reactions,
    endFailure,
  }: {
    microphoneOn: boolean;
    cameraOn: boolean;
    sharing: boolean;
    /** Whether the room is drawn as one large speaker with a strip, rather than an even gallery. */
    speakerView?: boolean;
    /** What the room carries. A call has no camera control and no screen share. */
    medium?: MeetingMedium;
    /** Whether this member may end the meeting for everybody. */
    canEnd?: boolean;
    /**
     * Whether this member is running the meeting, and therefore whether the band carries the menu
     * of acts over the whole room at all.
     *
     * A NON-HOST SEES NONE OF IT: absent, not disabled, on this band's own standing rule. A band
     * that grew five controls only three people in the room can use would cost every other member
     * the space, and a disabled control would say "this could happen here" when it could not.
     */
    hosting?: boolean;
    /** Whether THIS member's hand is up, which is what the toggle says next. */
    handRaised?: boolean;
    /**
     * How many hands are up in the room.
     *
     * It rides a control of its own for the reason the door's count does: somebody running a
     * meeting learns that a colleague wants the floor by SEEING the number, and a count inside a
     * menu is a person with their hand up for ten minutes.
     */
    raisedHandCount?: number;
    /** Whether the door is shut, which is what the menu's item says next. */
    locked?: boolean;
    /** Whether arrivals wait at a door, which is what the menu's other item says next. */
    lobby?: MeetingLobbyMode;
    /**
     * How many people are standing at the door.
     *
     * It rides on a control of its own rather than on the menu, because a host running a meeting
     * learns somebody has arrived by seeing the count rather than by opening a menu to check.
     */
    waitingCount?: number;
    /** Whether anybody is on every screen in the room, which is what makes clearing it offerable. */
    spotlighted?: boolean;
    /** Which meeting is being ended, for the confirmation panel to name. */
    subtitle?: RecordSubject;
    /**
     * What this browser's tracks report about their own treatment, once something is captured.
     * Null before a capture — and then there is nothing to treat, so the Effects control is not
     * drawn at all rather than drawn over a panel with nothing in it that could act.
     */
    appliedEffects?: AppliedEffects | null;
    /**
     * What the member asked for. Read only where the track does not say: the switch's position is
     * the track's answer wherever the track gives one, because a browser may decline a treatment
     * and the member has to see that it did.
     */
    effectSettings?: MediaEffectSettings;
    /**
     * How many open polls this member has not answered. On the Polls control, for the lobby's
     * reason: a poll nobody sees is a poll nobody answers.
     */
    pollsWaiting?: number;
    /** How many questions are still waiting for an answer. On the Q&A control, for the same reason. */
    questionsWaiting?: number;
    /** Whether the room has announced a recording running, which is what the control says next. */
    recording?: boolean;
    /** Whether this member may start a recording: the right to record, and a grant on this room. */
    mayStartRecording?: boolean;
    /** Whether this member may stop a running one: the right to record, or any grant on this room. */
    mayStopRecording?: boolean;
    /**
     * Why this meeting can never be recorded, where it cannot. The Record control is then drawn
     * disabled with this sentence beside it, rather than offered and refused.
     */
    recordingUnavailable?: string | null;
    /** True while a stop is in flight, so the control cannot be pressed twice. */
    stoppingRecording?: boolean;
    /** Ask to start recording. The room screen asks for confirmation before anything is sent. */
    onRecord?: () => void;
    /** Stop the running recording. Nothing is lost by stopping, so it is not asked twice. */
    onStopRecording?: () => void;
    onToggleMicrophone: () => void;
    onToggleCamera: () => void;
    onToggleSharing: () => void;
    /**
     * Put this member's hand up or down.
     *
     * ONE CONTROL, NOT TWO, like every other toggle in this band: raising and lowering are the same
     * act read from either side, so the control holds its place and changes what it says. The
     * raised state is MARKED rather than merely pressed — a hand up is a request standing in the
     * room, not a mode this browser is in.
     */
    onToggleHand: () => void;
    /** Open the queue. Absent for everybody who is not running the meeting. */
    onOpenHands?: () => void;
    /** Clear the floor, from the host menu. A host's own hand goes down with the rest. */
    onLowerAllHands?: () => void;
    /** Swap between the even gallery and the large speaker. Absent where it is not offered. */
    onToggleSpeakerView?: () => void;
    /** Silence everybody who is neither this member nor a host or co-host. */
    onMuteAll?: () => void;
    /** Shut the door, or open it again. */
    onSetLocked?: (locked: boolean) => void;
    /**
     * Hold arrivals in a lobby, or let them straight in.
     *
     * Turning it OFF admits nobody: the people already at the door stay there until a host decides
     * about each of them, because somebody may be waiting precisely because the host means to turn
     * them away, and a switch must never become an admission nobody made.
     */
    onSetLobby?: (lobby: MeetingLobbyMode) => void;
    /** Open the panel naming who is at the door. */
    onOpenLobby?: () => void;
    /** Take whoever is on every screen off it. */
    onClearSpotlight?: () => void;
    /** Open the panel naming who is running this meeting. */
    onOpenHosts?: () => void;
    /**
     * Change what is done to this member's own sound and picture. The room screen remembers the
     * choice and hands it to the client, which asks the tracks and reads back what they did. The
     * second argument says which half of the panel the change came from, so a change to the
     * microphone never moves a blur the member did not touch.
     */
    onChangeEffects?: (settings: MediaEffectSettings, change: EffectsChange) => void;
    /**
     * Stand this member in front of a picture from their own computer. The file never leaves their
     * browser; the room sees only the composite.
     */
    onChooseBackgroundImage?: (file: File) => void;
    /** Open the polls. Absent where the room screen offers no polls panel. */
    onOpenPolls?: () => void;
    /** Open the question queue. Absent where the room screen offers no queue. */
    onOpenQuestions?: () => void;
    /**
     * The connection control, which the room screen supplies because the panel behind it is built
     * from what the room's own diagnostics hold. The band owns WHERE it sits; the control owns what
     * it says and what it opens.
     */
    connection?: Snippet;
    /**
     * The chat control, which the room screen supplies because the panel behind it is built from
     * what the room is reading. The band owns WHERE it sits; the control owns what it says, which
     * includes the count of what has been said since it was last opened.
     */
    chat?: Snippet;
    /**
     * The reactions control, which the room screen supplies for the reason the two above are
     * supplied: the band owns WHERE a control sits, and the control owns what it offers.
     */
    reactions?: Snippet;
    onLeave: () => void;
    /** Ends it for everybody. Reports how the write went, so the panel can stand its ground. */
    onEnd?: () => Promise<ActionOutcome>;
    /** A failed end, in the app's own words, rendered in the panel's reserved band. */
    endFailure?: Snippet;
  } = $props();

  let ending = $state(false);

  /** What ending this room is called. A call is not a meeting and is not ended as one. */
  const endLabel = $derived(medium === "audio" ? "End Call" : "End Meeting");
  /** The word the confirmation uses for the room itself, for the same reason. */
  const roomNoun = $derived(medium === "audio" ? "call" : "meeting");

  /**
   * Where the noise switch stands: what the TRACK says, and what was asked only where the track does
   * not say. A browser can decline a treatment, and a switch that showed the preference would tell a
   * member their sound is cleaned up when it is not.
   */
  const reducingNoise = $derived(
    appliedEffects?.noiseRemoval === "on" ||
      (appliedEffects?.audio.noiseSuppression ?? effectSettings.reduceNoise),
  );

  /**
   * Whether the product's own filter is cleaning the microphone, read off what the stage reports it
   * started, never off the preference: a filter that could not start must not show as on.
   */
  const removingNoise = $derived(appliedEffects?.noiseRemoval === "on");

  /**
   * Whether the member pressed Image before any picture was chosen, so the panel is asking for one.
   * Choosing Image with nothing to show would publish nothing different, so the picture comes first.
   */
  let askingForImage = $state(false);

  function chooseBackground(background: MediaEffectSettings["background"]): void {
    if (appliedEffects === null) return;
    if (background === "image" && !appliedEffects.imageChosen) {
      askingForImage = true;
      return;
    }
    askingForImage = false;
    if (background === appliedEffects.background) return;
    onChangeEffects?.({ ...effectSettings, background }, "background");
  }

  function chooseImageFile(file: File | null): void {
    if (file === null) return;
    askingForImage = false;
    onChooseBackgroundImage?.(file);
  }

  /*
   * Said to be about the microphone, so the stage leaves the camera alone: measured against what the
   * camera reports instead, a blur the machine turned on would be "corrected" off by a member who
   * only asked for less noise.
   */
  function chooseNoiseReduction(reduceNoise: boolean): void {
    // No noise reduction at all means the stronger filter too: it is the same request, made harder.
    onChangeEffects?.(
      { ...effectSettings, reduceNoise, removeNoise: reduceNoise && effectSettings.removeNoise },
      "microphone",
    );
  }

  /** The stronger filter implies the ordinary request for less noise, so turning it on asks both. */
  function chooseNoiseRemoval(removeNoise: boolean): void {
    onChangeEffects?.(
      {
        ...effectSettings,
        removeNoise,
        reduceNoise: removeNoise || effectSettings.reduceNoise,
      },
      "microphone",
    );
  }
</script>

<!--
  What is done to this member's own sound and picture, read off their tracks. Every section draws
  only what can act here: the background is two rows where the product may set it and one line where
  it may not, and a call has no background section at all because it has no picture.
-->
{#snippet effectsControl(applied: AppliedEffects)}
  <Popover.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Popover.Trigger
            {...props}
            class={buttonClasses({ variant: "ghost", size: "icon" })}
            aria-label="Effects"
          >
            <SlidersHorizontal class="size-16" aria-hidden="true" />
          </Popover.Trigger>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="top">Effects</Tooltip.Content>
    </Tooltip.Root>

    <Popover.Content class="flex flex-col gap-16" style="inline-size: var(--mc-size-popover)">
      <h2 class="text-sm font-medium">Effects</h2>

      {#if medium === "video"}
        <section class="flex flex-col gap-8" aria-labelledby="meeting-effects-background">
          <h3 id="meeting-effects-background" class="text-xs font-medium text-text-muted">
            Background
          </h3>
          {#if applied.backgroundByProduct}
            <div class="flex flex-col gap-4">
              <ChoiceRow
                selected={applied.background === "none" && !askingForImage}
                onclick={() => chooseBackground("none")}
              >
                None
              </ChoiceRow>
              <ChoiceRow
                selected={applied.background === "blur" && !askingForImage}
                onclick={() => chooseBackground("blur")}
              >
                Blur
              </ChoiceRow>
              <ChoiceRow
                selected={applied.background === "image" || askingForImage}
                onclick={() => chooseBackground("image")}
              >
                Image
              </ChoiceRow>
            </div>
            {#if applied.background === "image" || askingForImage}
              <!-- The picture stays in this browser. It is cut down and kept here, and the room
                   only ever sees the member standing in front of it. -->
              <FileInput
                accept="image/png,image/jpeg,image/webp"
                aria-label={applied.imageChosen ? "Choose a different picture" : "Choose a picture"}
                onchange={(event) => chooseImageFile(event.currentTarget.files?.[0] ?? null)}
              />
            {/if}
          {:else if applied.blur === "on" || applied.blur === "off"}
            <div class="flex flex-col gap-4">
              <ChoiceRow
                selected={applied.blur === "off"}
                onclick={() => chooseBackground("none")}
              >
                None
              </ChoiceRow>
              <ChoiceRow
                selected={applied.blur === "on"}
                onclick={() => chooseBackground("blur")}
              >
                Blur
              </ChoiceRow>
            </div>
          {:else if applied.blur === "platform-controlled"}
            <p class="text-sm">{platformBlurStatement(applied.platformBlur)}</p>
          {:else}
            <p class="text-sm">{BLUR_UNAVAILABLE_STATEMENT}</p>
          {/if}
        </section>
      {/if}

      <section class="flex flex-col gap-8" aria-labelledby="meeting-effects-microphone">
        <h3 id="meeting-effects-microphone" class="text-xs font-medium text-text-muted">
          Microphone
        </h3>
        <div class="flex items-center gap-8">
          <Switch
            aria-labelledby="meeting-effects-noise-label"
            bind:checked={() => reducingNoise, chooseNoiseReduction}
          />
          <Label id="meeting-effects-noise-label">Reduce background noise</Label>
        </div>
        {#if applied.noiseRemoval === "on"}
          <p class="text-xs text-text-muted">{NOISE_REMOVAL_ON_STATEMENT}</p>
        {:else}
          <p class="text-xs text-text-muted">{audioTreatmentStatement(applied.audio)}</p>
        {/if}
        {#if applied.noiseRemoval !== "unavailable"}
          <div class="flex items-center gap-8">
            <Switch
              aria-labelledby="meeting-effects-noise-removal-label"
              aria-describedby="meeting-effects-noise-removal-description"
              bind:checked={() => removingNoise, chooseNoiseRemoval}
            />
            <Label id="meeting-effects-noise-removal-label">Stronger noise removal</Label>
          </div>
          <p id="meeting-effects-noise-removal-description" class="text-xs text-text-muted">
            {NOISE_REMOVAL_DESCRIPTION}
          </p>
        {/if}
      </section>

      {#if applied.refusal !== null}
        <!-- In the panel's own band and never a toast: a toast is gone by the time somebody looks
             back to see whether the thing they pressed happened. -->
        <FailureBand variant="warning" title="Not Applied" message={applied.refusal} />
      {/if}
    </Popover.Content>
  </Popover.Root>
{/snippet}

<div
  class="flex flex-wrap items-center gap-8"
  role="group"
  aria-label={medium === "audio" ? "Call controls" : "Meeting controls"}
>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant={microphoneOn ? "secondary" : "ghost"}
          size="icon"
          aria-pressed={microphoneOn}
          aria-label={microphoneOn ? "Mute your microphone" : "Unmute your microphone"}
          onclick={onToggleMicrophone}
        >
          {#if microphoneOn}
            <Mic class="size-16" aria-hidden="true" />
          {:else}
            <MicOff class="size-16" aria-hidden="true" />
          {/if}
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="top">Microphone</Tooltip.Content>
  </Tooltip.Root>

  {#if medium === "video"}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant={cameraOn ? "secondary" : "ghost"}
            size="icon"
            aria-pressed={cameraOn}
            aria-label={cameraOn ? "Turn your camera off" : "Turn your camera on"}
            onclick={onToggleCamera}
          >
            {#if cameraOn}
              <Video class="size-16" aria-hidden="true" />
            {:else}
              <VideoOff class="size-16" aria-hidden="true" />
            {/if}
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="top">Camera</Tooltip.Content>
    </Tooltip.Root>
  {/if}

  {#if appliedEffects !== null}
    {@render effectsControl(appliedEffects)}
  {/if}

  {#if medium === "video"}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant={sharing ? "secondary" : "ghost"}
            size="icon"
            aria-pressed={sharing}
            aria-label={sharing ? "Stop sharing your screen" : "Share your screen"}
            onclick={onToggleSharing}
          >
            {#if sharing}
              <ScreenShareOff class="size-16" aria-hidden="true" />
            {:else}
              <ScreenShare class="size-16" aria-hidden="true" />
            {/if}
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="top">Screen share</Tooltip.Content>
    </Tooltip.Root>

    {#if onToggleSpeakerView !== undefined}
      <!-- A view toggle whose glyph is the same on both sides, so the fill and `aria-pressed` are
           what say which side is on — the house pattern for exactly that case. -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant={speakerView ? "secondary" : "ghost"}
              size="icon"
              aria-pressed={speakerView}
              aria-label={speakerView ? "Show everybody" : "Show whoever is talking, large"}
              onclick={onToggleSpeakerView}
            >
              <Presentation class="size-16" aria-hidden="true" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Speaker view</Tooltip.Content>
      </Tooltip.Root>
    {/if}
  {/if}

  <!-- ASKING FOR THE FLOOR. It is a toggle like the microphone beside it, and it is MARKED rather
       than merely pressed: a hand up is a request standing in the room that somebody else can put
       down, so the glyph carries the accent and the label says which way the press goes. -->
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant={handRaised ? "secondary" : "ghost"}
          size="icon"
          aria-pressed={handRaised}
          aria-label={handRaised ? "Lower your hand" : "Raise your hand"}
          onclick={onToggleHand}
        >
          <Hand
            class={handRaised ? "size-16 text-accent-default" : "size-16"}
            aria-hidden="true"
          />
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="top">{handRaised ? "Lower hand" : "Raise hand"}</Tooltip.Content>
  </Tooltip.Root>

  <!-- The six, behind one control. It is the screen's snippet for the reason the two below are:
       what the menu offers is the client's vocabulary, and where it sits is the band's. -->
  {@render reactions?.()}

  <!-- The way to the numbers behind the marks. It is not a toggle, so it wears no fill and no
       pressed state: the band's other controls change what the room is doing, and this one only
       shows what it is already doing. -->
  {@render connection?.()}

  <!-- What is being said, beside what is being sent. It carries its own count, which is how a
       member learns something was said while they were watching the room rather than the panel. -->
  {@render chat?.()}

  {#if onOpenPolls !== undefined}
    <!-- The polls, for everybody: a member answers from here, and a host asks from here too. The
         count is the open polls this member has not answered, so it goes the moment they answer. -->
    <Button variant="secondary" onclick={onOpenPolls}>
      <Vote class="size-16" aria-hidden="true" />
      Polls
      {#if pollsWaiting > 0}
        <Badge variant="primary">{pollsWaiting}</Badge>
      {/if}
    </Button>
  {/if}

  {#if onOpenQuestions !== undefined}
    <!-- The question queue, for everybody. The count is what is still waiting for an answer. -->
    <Button variant="secondary" onclick={onOpenQuestions}>
      <MessageCircleQuestionMark class="size-16" aria-hidden="true" />
      Q&amp;A
      {#if questionsWaiting > 0}
        <Badge variant="primary">{questionsWaiting}</Badge>
      {/if}
    </Button>
  {/if}

  {#if recording && mayStopRecording && onStopRecording !== undefined}
    <!-- Stop, while the room says a recording runs. Before the menu rather than at the end of the
         band, for the lobby control's reason: the end is an anchor, and this control comes and goes
         with the recording. -->
    <Button variant="secondary" disabled={stoppingRecording} onclick={onStopRecording}>
      <CircleStop class="size-16" aria-hidden="true" />
      Stop Recording
    </Button>
  {:else if !recording && mayStartRecording && onRecord !== undefined}
    {#if recordingUnavailable === null}
      <Button variant="secondary" onclick={onRecord}>
        <Circle class="size-16 fill-current text-status-danger" aria-hidden="true" />
        Record
      </Button>
    {:else}
      <!-- A meeting that can never be recorded keeps the control in its place, disabled, with the
           reason beside it in words rather than on a hover a touch screen never shows. -->
      <span class="flex items-center gap-8">
        <Button variant="secondary" disabled aria-describedby="meeting-recording-unavailable">
          <Circle class="size-16" aria-hidden="true" />
          Record
        </Button>
        <span id="meeting-recording-unavailable" class="text-xs text-text-muted">
          {recordingUnavailable}
        </span>
      </span>
    {/if}
  {/if}

  {#if hosting && onOpenLobby !== undefined}
    <!-- THE ONE ROOM ACT THAT EARNS ITS OWN CONTROL, because it is the only one that has something
         to SAY. A host running a meeting learns somebody is standing outside by seeing the count,
         and a count inside a menu is a person left at a door for ten minutes. It sits before the
         menu rather than at the end of the band: the end is an anchor, and a control whose badge
         comes and goes must not hold it. -->
    <Button variant="secondary" onclick={onOpenLobby}>
      {#if lobby === "on"}
        <DoorClosed class="size-16" aria-hidden="true" />
      {:else}
        <DoorOpen class="size-16" aria-hidden="true" />
      {/if}
      Lobby
      {#if waitingCount > 0}
        <Badge variant="primary">{waitingCount}</Badge>
      {/if}
    </Button>
  {/if}

  {#if hosting && onOpenHands !== undefined}
    <!-- THE SECOND ROOM ACT THAT EARNS ITS OWN CONTROL, on the lobby control's own argument: the
         queue has something to SAY, and a host who is watching the room rather than a menu learns
         that somebody wants the floor by seeing the count. It sits before the menu for the same
         reason the lobby does — the end of the band is an anchor, and a control whose badge comes
         and goes must not hold it. -->
    <Button variant="secondary" onclick={onOpenHands}>
      <Hand class="size-16" aria-hidden="true" />
      Hands
      {#if raisedHandCount > 0}
        <Badge variant="primary">{raisedHandCount}</Badge>
      {/if}
    </Button>
  {/if}

  {#if hosting}
    <!-- ONE MENU RATHER THAN A ROW OF NEW GLYPHS. The acts over the whole room are four, and four
         more controls in a band every member reads would cost everybody else the space so that
         three people could save a click. -->
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonClasses({ variant: "secondary", size: "default" })}
        aria-label="Host controls"
      >
        <ShieldUser class="size-16" aria-hidden="true" />
        Host Controls
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" style="inline-size: var(--mc-size-popover)">
        <DropdownMenu.Item onSelect={() => onMuteAll?.()}>
          <MicOff class="size-16 shrink-0" aria-hidden="true" />
          Mute Everyone
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => onSetLocked?.(!locked)}>
          {#if locked}
            <LockOpen class="size-16 shrink-0" aria-hidden="true" />
            Unlock the Room
          {:else}
            <Lock class="size-16 shrink-0" aria-hidden="true" />
            Lock the Room
          {/if}
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => onSetLobby?.(lobby === "on" ? "off" : "on")}>
          {#if lobby === "on"}
            <DoorOpen class="size-16 shrink-0" aria-hidden="true" />
            Let Arrivals Straight In
          {:else}
            <DoorClosed class="size-16 shrink-0" aria-hidden="true" />
            Hold Arrivals in a Lobby
          {/if}
        </DropdownMenu.Item>
        {#if raisedHandCount > 0}
          <!-- Offered only while there is a floor to clear: an item that lowers nothing teaches a
               reader that the menu does not mean what it says. -->
          <DropdownMenu.Item onSelect={() => onLowerAllHands?.()}>
            <Hand class="size-16 shrink-0" aria-hidden="true" />
            Lower All Hands
          </DropdownMenu.Item>
        {/if}
        {#if spotlighted}
          <!-- Offered only while somebody is on every screen: an item that clears nothing is an
               item that teaches a reader the menu does not mean what it says. -->
          <DropdownMenu.Item onSelect={() => onClearSpotlight?.()}>
            <Focus class="size-16 shrink-0" aria-hidden="true" />
            Stop Spotlighting
          </DropdownMenu.Item>
        {/if}
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => onOpenHosts?.()}>
          <ShieldUser class="size-16 shrink-0" aria-hidden="true" />
          Hosts
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}

  <Button variant="destructive" onclick={onLeave}>
    <PhoneOff class="size-16" aria-hidden="true" />
    Leave
  </Button>

  {#if canEnd && onEnd !== undefined}
    <Button variant="secondary" onclick={() => (ending = true)}>
      <Square class="size-16" aria-hidden="true" />
      {endLabel}
    </Button>
  {/if}
</div>

{#if canEnd && onEnd !== undefined}
  <ActionDialog
    bind:open={ending}
    kind="destructive"
    heading={endLabel}
    {subtitle}
    commitLabel={endLabel}
    commitBusyLabel="Ending"
    unsavedChanges={false}
    onCommit={onEnd}
  >
    {#snippet notice()}
      {@render endFailure?.()}
    {/snippet}

    {#snippet fields()}
      <p class="text-sm">
        Everybody is taken out of the room and the {roomNoun} closes. The record keeps who was in
        it and for how long.
      </p>
    {/snippet}
  </ActionDialog>
{/if}
