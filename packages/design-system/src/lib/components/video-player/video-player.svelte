<script lang="ts">
  /*
   * VideoPlayer (Tier 3) — the product's one player for a recording, drawn entirely by this system
   * over the browser's own media element. No player library sits underneath: the browser already
   * decodes, buffers and seeks, so what a library adds is controls, and controls are what this
   * package exists to own. A library's skin would also have to be forked to carry the controls a
   * firm reviewing a deposition needs (frame steps, a link to the exact moment, a still of a frame).
   *
   * THE CONTROLS LIE OVER THE PICTURE and step aside while it plays (owner's choice, 2026-11-12):
   * the picture takes the whole frame, the controls rise over its lower edge on the chrome ink, and
   * they fade once the pointer has rested for a moment while the recording plays. A paused
   * recording, an open menu, or focus inside the controls keeps them up, so a reviewer stepping
   * frames never has to summon them. A paused picture carries a large play control at its centre.
   *
   * The bar holds what is pressed often: play, frame and ten-second steps, sound, the time, and full
   * screen. Everything else is in the settings menu behind the cog: the speed (a submenu), the link
   * to the moment, a still of the frame, and the download where the caller offers one. Picture in
   * picture is not offered: the owner judged it unused.
   *
   * Two variants and two media. `full` is the viewer; `compact` is a preview inside a panel, one row
   * of play, seek, time, sound, settings and full screen. `media="audio"` is a recording with no
   * picture: there is nothing to lie over, so the controls sit on their own chrome panel, and the
   * picture-only controls (frame steps, the still, full screen) are not drawn.
   *
   * It is domain-blind. It takes an address to play and tells its caller what the reader asked for:
   * a link to a moment (`onCopyMoment`), a still of a frame (`onScreenshot`, handed the image), the
   * file itself (`onDownload`), and that the browser could not play the address after all
   * (`onUnplayable`). It never learns what a file, a matter or a grant is.
   *
   * The keys work while focus is inside the player, never on the whole page: K plays and pauses, J
   * and L step ten seconds, the comma and the full stop step a frame, M mutes and F goes full screen.
   */
  import Camera from "@lucide/svelte/icons/camera";
  import Download from "@lucide/svelte/icons/download";
  import Gauge from "@lucide/svelte/icons/gauge";
  import Link from "@lucide/svelte/icons/link";
  import Maximize from "@lucide/svelte/icons/maximize";
  import Minimize from "@lucide/svelte/icons/minimize";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Settings from "@lucide/svelte/icons/settings";
  import StepBack from "@lucide/svelte/icons/step-back";
  import StepForward from "@lucide/svelte/icons/step-forward";
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import VolumeX from "@lucide/svelte/icons/volume-x";
  import { onMount } from "svelte";
  import * as DropdownMenu from "../dropdown-menu/index.ts";
  import Slider from "../slider/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import {
    CONTROLS_IDLE_MILLISECONDS,
    FRAME_STEP_SECONDS,
    PLAYBACK_SPEEDS,
    SKIP_SECONDS,
    clampPosition,
    formatMediaTime,
    loadedFraction,
    positionAtPointer,
    speedLabel,
    spokenMediaTime,
  } from "./video-player-model.ts";

  let {
    src,
    title,
    variant = "full",
    media = "video",
    startAt = 0,
    onCopyMoment,
    onScreenshot,
    onDownload,
    onUnplayable,
    class: className,
  }: {
    /** The address the browser loads the recording from. */
    src: string;
    /** What the recording is called, for the player's accessible name. */
    title: string;
    variant?: "full" | "compact";
    /** Whether the recording has a picture. Sound alone is drawn as a panel of controls. */
    media?: "video" | "audio";
    /** Where playback starts, in seconds. */
    startAt?: number;
    /** Offered as "Copy Link at <time>" when present; called with the paused-on moment. */
    onCopyMoment?: (seconds: number) => void;
    /**
     * Offered as "Save Screenshot" on a picture when present. Called with the frame as a PNG and the
     * second it was taken at, or with null when the browser would not hand the frame back (an
     * address that grants no cross-origin read). Asking for it loads the recording with
     * `crossorigin="anonymous"`, so the address must answer that request.
     */
    onScreenshot?: (image: Blob | null, seconds: number) => void;
    /** Offered as "Download" in the settings menu when present. */
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
  let failed = $state(false);
  let menuOpen = $state(false);
  let resting = $state(false);
  let focusInside = $state(false);
  let hoverSeconds = $state<number | null>(null);
  let hoverLeft = $state(0);
  let startApplied = false;
  let restTimer: ReturnType<typeof setTimeout> | undefined;

  const hasPicture = $derived(media === "video");
  const loaded = $derived(loadedFraction(buffered, duration));
  const knownDuration = $derived(Number.isFinite(duration) ? duration : 0);
  const speedValue = $derived(String(playbackRate));
  /** The controls step aside only over a playing picture, with nobody reaching for them. */
  const controlsHidden = $derived(
    hasPicture && resting && !paused && !menuOpen && !focusInside && !failed,
  );
  /** Inside a full-screen player a menu must be drawn inside it, or the layer hides it. */
  const menuHome = $derived(fullScreen && container !== null ? container : undefined);

  function onFullScreenChange(): void {
    fullScreen = document.fullscreenElement !== null && document.fullscreenElement === container;
  }

  onMount(() => {
    document.addEventListener("fullscreenchange", onFullScreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullScreenChange);
      clearTimeout(restTimer);
    };
  });

  /** Any sign of a reader brings the controls back, and starts the wait before they step aside. */
  function wake(): void {
    resting = false;
    clearTimeout(restTimer);
    restTimer = setTimeout(() => (resting = true), CONTROLS_IDLE_MILLISECONDS);
  }

  function onLoadedMetadata(): void {
    if (startApplied || video === null) return;
    startApplied = true;
    if (startAt > 0) video.currentTime = clampPosition(startAt, video.duration);
  }

  /*
   * A browser that cannot decode a recording's picture does not always say so: given HEVC it has no
   * decoder for, a browser can play the sound under a blank frame and report no error at all. Once
   * the first frame is due, a picture with no width is that case, and it is refused the same way.
   * Sound alone has no picture to measure.
   */
  function onLoadedData(): void {
    if (hasPicture && video !== null && video.videoWidth === 0) onError();
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
    wake();
  }

  function moveBy(seconds: number): void {
    if (video === null) return;
    video.currentTime = clampPosition(video.currentTime + seconds, video.duration);
  }

  function stepFrame(direction: 1 | -1): void {
    if (video === null || !hasPicture) return;
    video.pause();
    moveBy(direction * FRAME_STEP_SECONDS);
  }

  function toggleMute(): void {
    muted = !muted;
  }

  function toggleFullScreen(): void {
    if (container === null || !hasPicture) return;
    if (document.fullscreenElement === container) void document.exitFullscreen();
    else void container.requestFullscreen().catch(() => undefined);
  }

  function copyMoment(): void {
    onCopyMoment?.(Math.floor(currentTime));
  }

  /*
   * The still is the frame as decoded, at its own size rather than the size it is shown at. A
   * browser refuses to hand back a frame from an address that granted no cross-origin read, and
   * that refusal is reported to the caller rather than swallowed.
   */
  function takeScreenshot(): void {
    if (video === null || onScreenshot === undefined) return;
    const seconds = Math.floor(video.currentTime);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (context === null || canvas.width === 0) {
      onScreenshot(null, seconds);
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      canvas.toBlob((image) => onScreenshot?.(image, seconds), "image/png");
    } catch {
      onScreenshot(null, seconds);
    }
  }

  // The hover preview: the time under the pointer, and for a picture the frame there, drawn from a
  // second element so the one being watched never moves. The second element is made on the first
  // hover, so a reader who never hovers the timeline never loads it.
  let scout: HTMLVideoElement | null = null;
  let previewCanvas = $state<HTMLCanvasElement | null>(null);
  let scoutBusy = false;
  let scoutWanted: number | null = null;

  function drawScoutFrame(): void {
    if (scout === null || previewCanvas === null) return;
    const context = previewCanvas.getContext("2d");
    context?.drawImage(scout, 0, 0, previewCanvas.width, previewCanvas.height);
    scoutBusy = false;
    if (scoutWanted !== null && scoutWanted !== scout.currentTime) seekScout(scoutWanted);
  }

  function seekScout(seconds: number): void {
    if (!hasPicture || variant !== "full") return;
    if (scout === null) {
      scout = document.createElement("video");
      scout.muted = true;
      scout.preload = "metadata";
      scout.src = src;
      scout.addEventListener("seeked", drawScoutFrame);
    }
    scoutWanted = seconds;
    if (scoutBusy) return;
    scoutBusy = true;
    scout.currentTime = seconds;
  }

  function onTimelinePointer(event: PointerEvent): void {
    const timeline = event.currentTarget as HTMLElement;
    const box = timeline.getBoundingClientRect();
    hoverSeconds = positionAtPointer(event.clientX, box.left, box.width, knownDuration);
    hoverLeft = event.clientX - box.left;
    seekScout(hoverSeconds);
  }

  $effect(() => {
    return () => {
      scout?.removeEventListener("seeked", drawScoutFrame);
      scout?.removeAttribute("src");
      scout = null;
    };
  });

  function onKeydown(event: KeyboardEvent): void {
    wake();
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (
      target !== null &&
      target.closest("input, textarea, select, [role='listbox'], [role='menu']") !== null
    ) {
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

{#snippet playControl()}
  <button
    type="button"
    class="mc-video-player-control"
    title={paused ? "Play" : "Pause"}
    aria-label={paused ? "Play" : "Pause"}
    disabled={failed}
    onclick={togglePlayback}
  >
    {#if paused}<Play aria-hidden="true" />{:else}<Pause aria-hidden="true" />{/if}
  </button>
{/snippet}

{#snippet soundControl()}
  <button
    type="button"
    class="mc-video-player-control"
    title={muted ? "Unmute" : "Mute"}
    aria-label={muted ? "Unmute" : "Mute"}
    onclick={toggleMute}
  >
    {#if muted}<VolumeX aria-hidden="true" />{:else}<Volume2 aria-hidden="true" />{/if}
  </button>
{/snippet}

{#snippet fullScreenControl()}
  {#if hasPicture}
    <button
      type="button"
      class="mc-video-player-control"
      title={fullScreen ? "Exit Full Screen" : "Full Screen"}
      aria-label={fullScreen ? "Exit Full Screen" : "Full Screen"}
      onclick={toggleFullScreen}
    >
      {#if fullScreen}<Minimize aria-hidden="true" />{:else}<Maximize aria-hidden="true" />{/if}
    </button>
  {/if}
{/snippet}

{#snippet timeline()}
  <!-- The pointer over the timeline only previews; pressing it is the slider's own. -->
  <div
    class="mc-video-player-timeline"
    role="presentation"
    onpointermove={onTimelinePointer}
    onpointerleave={() => (hoverSeconds = null)}
  >
    <Slider
      tone="chrome"
      label="Seek"
      min={0}
      max={knownDuration}
      step={1}
      disabled={failed || knownDuration === 0}
      valueText="{spokenMediaTime(currentTime)} of {spokenMediaTime(knownDuration)}"
      buffered={loaded}
      bind:value={() => currentTime, (next) => (currentTime = next)}
    />
    {#if hoverSeconds !== null && knownDuration > 0}
      <span class="mc-video-player-preview -translate-x-1/2" style="inset-inline-start: {hoverLeft}px">
        {#if hasPicture && variant === "full"}
          <canvas bind:this={previewCanvas} class="mc-video-player-preview-frame" width="160" height="90"
          ></canvas>
        {/if}
        <span class="mc-video-player-preview-time">{formatMediaTime(hoverSeconds)}</span>
      </span>
    {/if}
  </div>
{/snippet}

{#snippet settingsMenu()}
  <DropdownMenu.Root openOnHover={false} bind:open={menuOpen}>
    <DropdownMenu.Trigger class="mc-video-player-control" title="Settings" aria-label="Settings">
      <Settings aria-hidden="true" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content side="top" align="end" portalTo={menuHome}>
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger submenuSide="left" disabled={failed}>
          <Gauge class="size-16" aria-hidden="true" />
          <span class="flex-1">Speed</span>
          <span class="text-text-muted">{speedLabel(playbackRate)}</span>
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent side="left" portalTo={menuHome}>
          <DropdownMenu.RadioGroup
            value={speedValue}
            onValueChange={(next) => (playbackRate = Number(next) || 1)}
          >
            {#each PLAYBACK_SPEEDS as speed (speed)}
              <DropdownMenu.RadioItem value={String(speed)}>{speedLabel(speed)}</DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
      {#if onCopyMoment !== undefined}
        <DropdownMenu.Item disabled={failed} onSelect={copyMoment}>
          <Link class="size-16" aria-hidden="true" />
          Copy Link at {formatMediaTime(currentTime)}
        </DropdownMenu.Item>
      {/if}
      {#if onScreenshot !== undefined && hasPicture}
        <DropdownMenu.Item disabled={failed} onSelect={takeScreenshot}>
          <Camera class="size-16" aria-hidden="true" />
          Save Screenshot
        </DropdownMenu.Item>
      {/if}
      {#if onDownload !== undefined}
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={onDownload}>
          <Download class="size-16" aria-hidden="true" />
          Download
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<!-- The keys are scoped to the player: a key press elsewhere on the page never reaches them. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={container}
  role="region"
  aria-label={title}
  class={mergeClasses("mc-video-player", controlsHidden && "cursor-none", className)}
  data-variant={variant}
  data-media={media}
  onkeydown={onKeydown}
  onpointermove={wake}
  onpointerdown={wake}
  onpointerleave={() => (resting = true)}
  onfocusin={() => (focusInside = true)}
  onfocusout={(event) => {
    const next = event.relatedTarget as Node | null;
    focusInside = next !== null && container?.contains(next) === true;
  }}
>
  <div class="mc-video-player-stage">
    <!-- A recording a firm holds has no caption file yet; captions arrive with transcripts. -->
    <!-- Sound alone plays through the same element, which is simply not drawn. -->
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
      class={mergeClasses("mc-video-player-media h-full w-full", !hasPicture && "hidden")}
      {src}
      crossorigin={onScreenshot !== undefined && hasPicture ? "anonymous" : undefined}
      preload="metadata"
      playsinline
      onloadedmetadata={onLoadedMetadata}
      onloadeddata={onLoadedData}
      onerror={onError}
      onclick={togglePlayback}
      ondblclick={toggleFullScreen}
    ></video>
    {#if hasPicture && paused && !failed && variant === "full"}
      <button
        type="button"
        class="mc-video-player-centre-play"
        title="Play"
        aria-label="Play from the Picture"
        onclick={togglePlayback}
      >
        <Play aria-hidden="true" />
      </button>
    {/if}
  </div>

  <div
    class={mergeClasses(
      "mc-video-player-chrome transition-opacity duration-normal motion-reduce:transition-none",
      hasPicture && "bg-linear-to-t from-chrome-surface/90 to-transparent",
      controlsHidden && "pointer-events-none opacity-0",
    )}
  >
    {#if variant === "full"}
      {@render timeline()}
      <div class="mc-video-player-row">
        {@render playControl()}
        {#if hasPicture}
          <button
            type="button"
            class="mc-video-player-control"
            title="Back One Frame"
            aria-label="Back One Frame"
            disabled={failed}
            onclick={() => stepFrame(-1)}
          >
            <StepBack aria-hidden="true" />
          </button>
        {/if}
        <button
          type="button"
          class="mc-video-player-control"
          title="Back {SKIP_SECONDS} Seconds"
          aria-label="Back {SKIP_SECONDS} Seconds"
          disabled={failed}
          onclick={() => moveBy(-SKIP_SECONDS)}
        >
          <RotateCcw aria-hidden="true" />
        </button>
        <button
          type="button"
          class="mc-video-player-control"
          title="Forward {SKIP_SECONDS} Seconds"
          aria-label="Forward {SKIP_SECONDS} Seconds"
          disabled={failed}
          onclick={() => moveBy(SKIP_SECONDS)}
        >
          <RotateCw aria-hidden="true" />
        </button>
        {#if hasPicture}
          <button
            type="button"
            class="mc-video-player-control"
            title="Forward One Frame"
            aria-label="Forward One Frame"
            disabled={failed}
            onclick={() => stepFrame(1)}
          >
            <StepForward aria-hidden="true" />
          </button>
        {/if}
        {@render soundControl()}
        <Slider
          tone="chrome"
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
        <span class="mc-video-player-time">
          {formatMediaTime(currentTime)}
          <span class="mc-video-player-time-total">/ {formatMediaTime(knownDuration)}</span>
        </span>
        <span class="flex-1"></span>
        {@render settingsMenu()}
        {@render fullScreenControl()}
      </div>
    {:else}
      <div class="mc-video-player-row">
        {@render playControl()}
        {@render timeline()}
        <span class="mc-video-player-time">
          {formatMediaTime(currentTime)}
          <span class="mc-video-player-time-total">/ {formatMediaTime(knownDuration)}</span>
        </span>
        {@render soundControl()}
        {@render settingsMenu()}
        {@render fullScreenControl()}
      </div>
    {/if}
  </div>
</div>
