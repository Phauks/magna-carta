<script lang="ts">
  /*
   * VideoPlayer (Tier 3) — the product's one player for a recording, drawn entirely by this system
   * over the browser's own <video> element. No player library sits underneath: the browser already
   * decodes, buffers and seeks, so what a library adds is controls, and controls are what this
   * package exists to own. A library's skin would also have to be forked to carry the controls a
   * firm reviewing a deposition needs (frame steps, a link to the exact moment), and a forked skin
   * is a second implementation of every button here.
   *
   * THE CONTROLS SIT BENEATH THE PICTURE, always visible, rather than floating over it and hiding
   * while it plays: a reviewer reads the timecode and steps frames while watching, and a bar that
   * vanishes is a bar that has to be summoned before every one of those.
   *
   * Two variants. `full` is the viewer: the seek bar between the two times, then play, frame and
   * ten-second steps, sound, the moment link when the caller can make one, speed, picture-in-picture
   * and full screen. `compact` is a preview inside a panel: play, the seek bar, the time, sound and
   * full screen.
   *
   * It is domain-blind. It takes an address to play and tells its caller two things: the moment a
   * reader wants a link to (`onCopyMoment`), and that the browser could not play the address after
   * all (`onUnplayable`), so the caller can offer the download instead. It never learns what a file,
   * a matter or a grant is.
   *
   * The keys work while focus is inside the player, never on the whole page: K plays and pauses, J
   * and L step ten seconds, the comma and the full stop step a frame, M mutes and F goes full screen.
   */
  import Download from "@lucide/svelte/icons/download";
  import Link from "@lucide/svelte/icons/link";
  import Maximize from "@lucide/svelte/icons/maximize";
  import Minimize from "@lucide/svelte/icons/minimize";
  import Pause from "@lucide/svelte/icons/pause";
  import PictureInPicture2 from "@lucide/svelte/icons/picture-in-picture-2";
  import Play from "@lucide/svelte/icons/play";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import StepBack from "@lucide/svelte/icons/step-back";
  import StepForward from "@lucide/svelte/icons/step-forward";
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import VolumeX from "@lucide/svelte/icons/volume-x";
  import { onMount } from "svelte";
  import Button from "../button/index.ts";
  import * as Select from "../select/index.ts";
  import Slider from "../slider/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import {
    FRAME_STEP_SECONDS,
    PLAYBACK_SPEEDS,
    SKIP_SECONDS,
    clampPosition,
    formatMediaTime,
    loadedFraction,
    speedLabel,
    spokenMediaTime,
  } from "./video-player-model.ts";

  let {
    src,
    title,
    variant = "full",
    startAt = 0,
    onCopyMoment,
    onDownload,
    onUnplayable,
    class: className,
  }: {
    /** The address the browser loads the recording from. */
    src: string;
    /** What the recording is called, for the player's accessible name. */
    title: string;
    variant?: "full" | "compact";
    /** Where playback starts, in seconds. */
    startAt?: number;
    /** Offered as "Copy Link at <time>" when present; called with the paused-on moment. */
    onCopyMoment?: (seconds: number) => void;
    /** Offered as a Download button in the compact bar when present. */
    onDownload?: () => void;
    /** Called once when the browser cannot play the address after all. */
    onUnplayable?: () => void;
    class?: string;
  } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let video = $state<HTMLVideoElement | null>(null);
  let paused = $state(true);
  let currentTime = $state(0);
  let duration = $state(0);
  let volume = $state(1);
  let muted = $state(false);
  let playbackRate = $state(1);
  let buffered = $state<{ start: number; end: number }[]>([]);
  let fullScreen = $state(false);
  let pictureInPictureOffered = $state(false);
  let failed = $state(false);
  let startApplied = false;

  const loaded = $derived(loadedFraction(buffered, duration));
  const knownDuration = $derived(Number.isFinite(duration) ? duration : 0);
  const speedValue = $derived(String(playbackRate));
  const speedItems = PLAYBACK_SPEEDS.map((speed) => ({
    value: String(speed),
    label: speedLabel(speed),
  }));

  function onFullScreenChange(): void {
    fullScreen = document.fullscreenElement !== null && document.fullscreenElement === container;
  }

  onMount(() => {
    pictureInPictureOffered =
      typeof document !== "undefined" && document.pictureInPictureEnabled === true;
    document.addEventListener("fullscreenchange", onFullScreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullScreenChange);
  });

  function onLoadedMetadata(): void {
    if (startApplied || video === null) return;
    startApplied = true;
    if (startAt > 0) video.currentTime = clampPosition(startAt, video.duration);
  }

  /*
   * A browser that cannot decode a recording's picture does not always say so: given HEVC it has no
   * decoder for, a browser can play the sound under a blank frame and report no error at all. Once
   * the first frame is due, a picture with no width is that case, and it is refused the same way.
   */
  function onLoadedData(): void {
    if (video !== null && video.videoWidth === 0) onError();
  }

  function onError(): void {
    if (failed) return;
    failed = true;
    onUnplayable?.();
  }

  function togglePlayback(): void {
    if (video === null || failed) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }

  function moveBy(seconds: number): void {
    if (video === null) return;
    video.currentTime = clampPosition(video.currentTime + seconds, video.duration);
  }

  function stepFrame(direction: 1 | -1): void {
    if (video === null) return;
    video.pause();
    moveBy(direction * FRAME_STEP_SECONDS);
  }

  function toggleMute(): void {
    muted = !muted;
  }

  function toggleFullScreen(): void {
    if (container === null) return;
    if (document.fullscreenElement === container) void document.exitFullscreen();
    else void container.requestFullscreen().catch(() => undefined);
  }

  function openPictureInPicture(): void {
    if (video === null) return;
    void video.requestPictureInPicture().catch(() => undefined);
  }

  function copyMoment(): void {
    onCopyMoment?.(Math.floor(currentTime));
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target !== null && target.closest("input, textarea, select, [role='listbox']") !== null) {
      return;
    }
    const actions: Record<string, () => void> = {
      k: togglePlayback,
      j: () => moveBy(-SKIP_SECONDS),
      l: () => moveBy(SKIP_SECONDS),
      ",": () => stepFrame(-1),
      ".": () => stepFrame(1),
      m: toggleMute,
      f: toggleFullScreen,
    };
    const action = actions[event.key.toLowerCase()];
    if (action === undefined) return;
    event.preventDefault();
    action();
  }
</script>

<!-- The keys are scoped to the player: a key press elsewhere on the page never reaches them. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={container}
  role="region"
  aria-label={title}
  class={mergeClasses("mc-video-player", className)}
  data-variant={variant}
  onkeydown={onKeydown}
>
  <div class="mc-video-player-stage">
    <!-- A recording a firm holds has no caption file yet; captions arrive with transcripts. -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={video}
      bind:paused
      bind:currentTime
      bind:duration
      bind:volume
      bind:muted
      bind:playbackRate
      bind:buffered
      class="mc-video-player-media max-h-full max-w-full"
      {src}
      preload="metadata"
      playsinline
      onloadedmetadata={onLoadedMetadata}
      onloadeddata={onLoadedData}
      onerror={onError}
      onclick={togglePlayback}
    ></video>
  </div>

  <div class="mc-video-player-bar">
    {#if variant === "full"}
      <div class="flex items-center gap-12">
        <span class="mc-video-player-time">{formatMediaTime(currentTime)}</span>
        <Slider
          label="Seek"
          min={0}
          max={knownDuration}
          step={1}
          disabled={failed || knownDuration === 0}
          valueText="{spokenMediaTime(currentTime)} of {spokenMediaTime(knownDuration)}"
          buffered={loaded}
          bind:value={() => currentTime, (next) => (currentTime = next)}
        />
        <span class="mc-video-player-time text-text-muted">{formatMediaTime(knownDuration)}</span>
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <Button
          variant="primary"
          size="icon"
          title={paused ? "Play" : "Pause"}
          aria-label={paused ? "Play" : "Pause"}
          disabled={failed}
          onclick={togglePlayback}
        >
          {#if paused}<Play aria-hidden="true" />{:else}<Pause aria-hidden="true" />{/if}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Back One Frame"
          aria-label="Back One Frame"
          disabled={failed}
          onclick={() => stepFrame(-1)}
        >
          <StepBack aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Back {SKIP_SECONDS} Seconds"
          aria-label="Back {SKIP_SECONDS} Seconds"
          disabled={failed}
          onclick={() => moveBy(-SKIP_SECONDS)}
        >
          <RotateCcw aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Forward {SKIP_SECONDS} Seconds"
          aria-label="Forward {SKIP_SECONDS} Seconds"
          disabled={failed}
          onclick={() => moveBy(SKIP_SECONDS)}
        >
          <RotateCw aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Forward One Frame"
          aria-label="Forward One Frame"
          disabled={failed}
          onclick={() => stepFrame(1)}
        >
          <StepForward aria-hidden="true" />
        </Button>
        <span class="mc-video-player-divider" aria-hidden="true"></span>
        <Button
          variant="ghost"
          size="icon"
          title={muted ? "Unmute" : "Mute"}
          aria-label={muted ? "Unmute" : "Mute"}
          onclick={toggleMute}
        >
          {#if muted}<VolumeX aria-hidden="true" />{:else}<Volume2 aria-hidden="true" />{/if}
        </Button>
        <Slider
          class="mc-video-player-volume"
          label="Volume"
          min={0}
          max={100}
          step={5}
          valueText="{Math.round(muted ? 0 : volume * 100)} percent"
          bind:value={
            () => Math.round(muted ? 0 : volume * 100),
            (next) => {
              volume = next / 100;
              muted = next === 0;
            }
          }
        />
        <span class="flex-1"></span>
        {#if onCopyMoment !== undefined}
          <Button variant="secondary" disabled={failed} onclick={copyMoment}>
            <Link aria-hidden="true" />
            Copy Link at {formatMediaTime(currentTime)}
          </Button>
        {/if}
        <Select.Root
          type="single"
          items={speedItems}
          value={speedValue}
          onValueChange={(next) => (playbackRate = Number(next) || 1)}
        >
          <Select.Trigger class="mc-video-player-speed w-auto" aria-label="Speed" disabled={failed}>
            <Select.Value placeholder={speedLabel(playbackRate)} />
          </Select.Trigger>
          <Select.Content>
            {#each speedItems as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
        {#if pictureInPictureOffered}
          <Button
            variant="ghost"
            size="icon"
            title="Picture in Picture"
            aria-label="Picture in Picture"
            disabled={failed}
            onclick={openPictureInPicture}
          >
            <PictureInPicture2 aria-hidden="true" />
          </Button>
        {/if}
        <Button
          variant="ghost"
          size="icon"
          title={fullScreen ? "Exit Full Screen" : "Full Screen"}
          aria-label={fullScreen ? "Exit Full Screen" : "Full Screen"}
          onclick={toggleFullScreen}
        >
          {#if fullScreen}<Minimize aria-hidden="true" />{:else}<Maximize aria-hidden="true" />{/if}
        </Button>
      </div>
    {:else}
      <div class="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon-sm"
          title={paused ? "Play" : "Pause"}
          aria-label={paused ? "Play" : "Pause"}
          disabled={failed}
          onclick={togglePlayback}
        >
          {#if paused}<Play aria-hidden="true" />{:else}<Pause aria-hidden="true" />{/if}
        </Button>
        <Slider
          label="Seek"
          min={0}
          max={knownDuration}
          step={1}
          disabled={failed || knownDuration === 0}
          valueText="{spokenMediaTime(currentTime)} of {spokenMediaTime(knownDuration)}"
          buffered={loaded}
          bind:value={() => currentTime, (next) => (currentTime = next)}
        />
        <span class="mc-video-player-time text-xs">
          {formatMediaTime(currentTime)}
          <span class="text-text-muted">/ {formatMediaTime(knownDuration)}</span>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          title={muted ? "Unmute" : "Mute"}
          aria-label={muted ? "Unmute" : "Mute"}
          onclick={toggleMute}
        >
          {#if muted}<VolumeX aria-hidden="true" />{:else}<Volume2 aria-hidden="true" />{/if}
        </Button>
        {#if onDownload !== undefined}
          <Button
            variant="ghost"
            size="icon-sm"
            title="Download"
            aria-label="Download"
            onclick={onDownload}
          >
            <Download aria-hidden="true" />
          </Button>
        {/if}
        <Button
          variant="ghost"
          size="icon-sm"
          title={fullScreen ? "Exit Full Screen" : "Full Screen"}
          aria-label={fullScreen ? "Exit Full Screen" : "Full Screen"}
          onclick={toggleFullScreen}
        >
          {#if fullScreen}<Minimize aria-hidden="true" />{:else}<Maximize aria-hidden="true" />{/if}
        </Button>
      </div>
    {/if}
  </div>
</div>
