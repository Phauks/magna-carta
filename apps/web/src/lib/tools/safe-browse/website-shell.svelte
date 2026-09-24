<script module lang="ts">
  import { finalHost } from "./capture-facts.ts";

  /*
   * The unified frame's top band is one continuous bar: the shell's address-bar row on the left
   * and the inspector's tab strip on the right sit side by side at the same height, their bottom
   * hairlines meeting as one line. Both rows size themselves from this one formula — the md
   * control height, the bar's vertical padding, and the bottom hairline (border-box) — so the
   * band cannot drift apart when either side's contents change. The tab strip
   * (snapshot-tabs.svelte) imports it rather than guessing.
   */
  export const CHROME_ROW_MIN_BLOCK_SIZE =
    "min-block-size: calc(var(--mc-density-control-md) + var(--mc-space-8) + var(--mc-space-8) + var(--mc-border-width-default))";

  /** What the redirect probe settled on, reported while the renderer is still working. */
  export interface ProbeFacts {
    redirectCount: number;
    finalUrl: string;
  }

  /**
   * The loading viewport's status line once the probe has settled: where the link really leads
   * and how many redirects it took, stated while the renderer still works on the screenshot.
   * The page announces the same sentence to assistive technology, so it lives here once.
   */
  export function probeNarrative(probe: ProbeFacts): string {
    if (probe.redirectCount === 0) {
      return "The address answered directly. Rendering the page…";
    }
    const host = finalHost(probe.finalUrl) ?? probe.finalUrl;
    const redirects =
      probe.redirectCount === 1 ? "1 redirect" : `${probe.redirectCount} redirects`;
    return `Landed on ${host} after ${redirects}. Rendering the page…`;
  }
</script>

<script lang="ts">
  /*
   * The browser-shell for a safe-browse capture. The shell's top bar IS the page's one entry: the
   * address field, the Load Website action, back/forward/refresh over the page's capture history,
   * a copy control for the entered address, screenshot actions (download, full screen), and the
   * Static/Live view toggle (Live streams one isolated remote browser the member drives, in place of
   * the screenshot; what each mode does is stated in the control's accessible description rather
   * than as visible chrome, which stays clean). The whole viewer is ONE framed unit: the
   * browser window on the left and the caller's inspector panel (the information tabs) attached
   * on the right, joined by a shared hairline so the two halves never read as separate cards; on
   * narrow screens the panel stacks beneath the viewport inside the same frame. Where a capture
   * lands somewhere other than it was asked, the inspector's Overview tab carries that fact —
   * the shell's chrome stays clean.
   *
   * The frame renders from page load and holds its shape through every state: while the isolated
   * remote browser works the viewport names the address being captured, keeps a live elapsed
   * readout, and narrates the honest facts as they arrive —
   * first that the link is being followed, then (once the redirect probe settles) where it landed
   * and after how many redirects, while the renderer finishes the full-page shot. Only the probe's
   * two facts show early; the finished screenshot and the inspector's tabs populate when the
   * capture has completed (nothing partial), and a failed capture's alert renders inside the same
   * viewport so the layout never collapses. Everything in the frame is inert — the screenshot is
   * a plain <img> over a data: URL (full-screen included; captures are full-page and can be very
   * tall, so both surfaces scroll the image inside themselves), and every address is text, never
   * an anchor.
   */
  import type { Snippet } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import FolderDown from "@lucide/svelte/icons/folder-down";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";

  let {
    address = $bindable(""),
    capturing = false,
    capturingUrl = null,
    canSubmit = false,
    invalidHint = null,
    note = null,
    canGoBack = false,
    canGoForward = false,
    canRefresh = false,
    probe = null,
    screenshot = null,
    downloadFilename = null,
    hasCapture = false,
    mode = "static",
    onmodechange,
    ondownloadcapture,
    onsubmit,
    onback,
    onforward,
    onrefresh,
    problem,
    screen,
    inspector,
  }: {
    /** The address in the entry field; the page binds and reads it. */
    address?: string;
    /** Whether the isolated browser is still rendering — the viewport holds its placeholder. */
    capturing?: boolean;
    /** The address the running capture was asked for, shown in the loading viewport. */
    capturingUrl?: string | null;
    /** Whether the entered address is well-formed and a capture may start. */
    canSubmit?: boolean;
    /** What is wrong with the entered address, or null when nothing is. */
    invalidHint?: string | null;
    /**
     * A standing fact about the shell itself, stated at the address bar because that is where it
     * bears on the press. It yields to `invalidHint`: the two share one band, and what is wrong
     * with THIS address outranks what is always true of the shell.
     */
    note?: string | null;
    /** Whether the capture history holds an entry behind the current one. */
    canGoBack?: boolean;
    /** Whether the capture history holds an entry ahead of the current one. */
    canGoForward?: boolean;
    /** Whether there is a current capture to re-capture. */
    canRefresh?: boolean;
    /** The running capture's settled probe facts, or null until the probe reports. */
    probe?: ProbeFacts | null;
    /** The finished screenshot as an <img> source, or null when the renderer returned none. */
    screenshot?: string | null;
    /** What the screenshot saves as when downloaded, or null when there is none to save. */
    downloadFilename?: string | null;
    /** Whether a completed capture is on show (decides the no-screenshot line). */
    hasCapture?: boolean;
    /**
     * Which browser the address bar drives. `static` opens every address in a fresh isolated
     * browser; `live` keeps one for the member between pages, so a link's cookie-gated steps can
     * be followed. The page owns the value, because switching away from live ends a billed session.
     */
    mode?: "static" | "live";
    /** The member chose the other mode. Disabled while a capture runs, so a result never lands in a mode it was not asked in. */
    onmodechange?: (mode: "static" | "live") => void;
    /** Save the screenshot and every fact the panel shows as one archive. Absent while there is none. */
    ondownloadcapture?: () => void;
    /** Starts a capture of the entered address; the shell has already prevented the submit. */
    onsubmit?: () => void;
    onback?: () => void;
    onforward?: () => void;
    onrefresh?: () => void;
    /** A failed capture's alert, rendered inside the viewport so the frame holds. */
    problem?: Snippet;
    /**
     * What fills the viewport instead of a captured screenshot: in Live, the streamed remote
     * screen. When given, it owns the viewport outright — the capture states do not apply to it.
     */
    screen?: Snippet;
    /** The attached inspector panel — the frame's right half, stacking beneath on narrow screens. */
    inspector?: Snippet;
  } = $props();

  const addressInputIdentifier = $props.id();
  const invalidHintIdentifier = `${addressInputIdentifier}-invalid`;
  const modeDescriptionIdentifier = `${addressInputIdentifier}-mode`;

  let copiedAddress = $state(false);
  let addressCopyTimer: ReturnType<typeof setTimeout> | null = null;
  let expanded = $state(false);
  let elapsedSeconds = $state(0);

  // The live elapsed readout beside the loading line. One interval per capture, torn down with
  // the state — alongside the probe's facts, seconds elapsed is the other honest live fact.
  $effect(() => {
    if (!capturing) return;
    elapsedSeconds = 0;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    }, 1000);
    return () => clearInterval(timer);
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    onsubmit?.();
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      copiedAddress = true;
      if (addressCopyTimer !== null) clearTimeout(addressCopyTimer);
      addressCopyTimer = setTimeout(() => (copiedAddress = false), 1500);
    } catch {
      // The clipboard is unavailable here; nothing was copied, so nothing gets confirmed.
    }
  }

  // A programmatic anchor with the download attribute, so the data: screenshot saves under its
  // derived name; the anchor is never inserted into the page.
  function downloadScreenshot() {
    if (screenshot === null || downloadFilename === null) return;
    const anchor = document.createElement("a");
    anchor.href = screenshot;
    anchor.download = downloadFilename;
    anchor.click();
  }
</script>

<!-- The framed unit takes the page column's remaining height on wide screens (min-h-96 keeps a
     short window from crushing it to nothing; below that the page scrolls). Stacked narrow
     screens size naturally: the viewport keeps its video aspect and the panels their square. -->
<div
  class="flex flex-col overflow-hidden rounded-md border border-border-default lg:min-h-96 lg:flex-1 lg:flex-row"
>
  <div class="flex min-w-0 flex-col lg:w-3/5">
    <form
      onsubmit={submit}
      class="flex min-w-0 flex-wrap items-center gap-8 border-b border-border-default bg-surface-sunken px-12 py-8"
      style={CHROME_ROW_MIN_BLOCK_SIZE}
    >
      <div class="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          disabled={capturing || !canGoBack}
          onclick={onback}
        >
          <ArrowLeft class="size-16" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Forward"
          disabled={capturing || !canGoForward}
          onclick={onforward}
        >
          <ArrowRight class="size-16" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh"
          disabled={capturing || !canRefresh}
          onclick={onrefresh}
        >
          <RotateCw class="size-16" aria-hidden="true" />
        </Button>
      </div>
      <!-- One segmented button, not two: the halves touch with square inner edges, a single
           hairline between them, and the group's rounding on the outer corners only, so the pair
           reads as one two-state control whose filled side is the active view. -->
      <div class="inline-flex items-center" role="group" aria-label="View Mode">
        <!-- The unpressed half carries the hairline on the side that faces the other, so the pair
             reads as one control whichever side is filled. -->
        <Button
          variant={mode === "static" ? "primary" : "ghost"}
          size="sm"
          class={mode === "static" ? "rounded-e-none" : "rounded-e-none border-e border-border-default"}
          aria-pressed={mode === "static"}
          aria-describedby={modeDescriptionIdentifier}
          disabled={capturing}
          onclick={() => onmodechange?.("static")}
        >
          Static
        </Button>
        <Button
          variant={mode === "live" ? "primary" : "ghost"}
          size="sm"
          class={mode === "live" ? "rounded-s-none" : "rounded-s-none border-s border-border-default"}
          aria-pressed={mode === "live"}
          aria-describedby={modeDescriptionIdentifier}
          disabled={capturing}
          onclick={() => onmodechange?.("live")}
        >
          Live
        </Button>
        <p id={modeDescriptionIdentifier} class="sr-only">
          Static opens each address in a fresh isolated browser and shows a picture of it. Live
          streams one isolated browser you can click, scroll and type into, keeping its cookies as
          you follow a link through its steps.
        </p>
      </div>
      <Label for={addressInputIdentifier} class="sr-only">Web address to view</Label>
      <Input
        id={addressInputIdentifier}
        name="url"
        class="min-w-0 flex-1 font-mono"
        bind:value={address}
        placeholder="https://example.com"
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        disabled={capturing}
        aria-describedby={invalidHint === null ? undefined : invalidHintIdentifier}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={copiedAddress ? "Copied" : "Copy Address"}
        disabled={address.trim() === ""}
        onclick={copyAddress}
      >
        {#if copiedAddress}
          <Check class="size-16" aria-hidden="true" />
        {:else}
          <Copy class="size-16" aria-hidden="true" />
        {/if}
      </Button>
      <Button type="submit" variant="primary" disabled={!canSubmit}>
        {capturing ? "Capturing…" : "Load Website"}
      </Button>
      <div class="flex items-center gap-4">
        <!-- The picture-only controls are absent while a streamed screen fills the viewport: there is
             no single picture to save or enlarge, and a control that is always disabled states
             nothing. The archive download below takes a fresh full-page capture instead. -->
        {#if !screen}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Download Image"
            disabled={screenshot === null || downloadFilename === null}
            onclick={downloadScreenshot}
          >
            <Download class="size-16" aria-hidden="true" />
          </Button>
        {/if}
        <!-- Everything the capture found, not only the picture: the screenshot plus every fact the
             panel shows, in one archive. Beside the image download because a member reaching for
             one is usually deciding whether they need the other. -->
        <Button
          variant="ghost"
          size="icon"
          aria-label="Download Screenshot and Details"
          title="Download the screenshot and everything in the panel as one file"
          disabled={!hasCapture || ondownloadcapture === undefined}
          onclick={() => ondownloadcapture?.()}
        >
          <FolderDown class="size-16" aria-hidden="true" />
        </Button>
        {#if !screen}
          <Button
            variant="ghost"
            size="icon"
            aria-label="View Full Screen"
            disabled={screenshot === null}
            onclick={() => (expanded = true)}
          >
            <Maximize2 class="size-16" aria-hidden="true" />
          </Button>
        {/if}
      </div>
    </form>

    {#if invalidHint !== null}
      <p
        id={invalidHintIdentifier}
        class="border-b border-border-default px-12 py-8 text-xs text-text-muted"
      >
        {invalidHint}
      </p>
    {:else if note !== null}
      <p class="border-b border-border-default px-12 py-8 text-xs text-text-muted">
        {note}
      </p>
    {/if}

    <div
      class="mc-scrollbar aspect-video grow overflow-y-auto bg-surface-sunken lg:aspect-auto lg:min-h-0"
    >
      {#if screen}
        {@render screen()}
      {:else if capturing}
        <!-- The probe settles before the renderer, so once it reports the viewport shows its two
             honest facts early: the landed address takes the mono line and the status line says
             how many redirects it took. The tabs still wait for completion. This is a live act
             narrating its real stages, not a shape waiting for data, so it draws no placeholder:
             the address, the stage line and the ticking seconds are the whole of it. -->
        <div class="flex h-full flex-col items-center justify-center gap-8 p-16">
          {#if probe !== null}
            <p
              class="max-w-full truncate font-mono text-sm text-text-default"
              title={probe.finalUrl}
            >
              {probe.finalUrl}
            </p>
          {:else if capturingUrl !== null}
            <p
              class="max-w-full truncate font-mono text-sm text-text-default"
              title={capturingUrl}
            >
              {capturingUrl}
            </p>
          {/if}
          <p class="text-sm text-text-muted">
            {probe !== null
              ? probeNarrative(probe)
              : "Following the link and opening the page in the isolated remote browser…"}
          </p>
          <p class="font-mono text-xs text-text-muted">{elapsedSeconds}s</p>
        </div>
      {:else if problem}
        <div class="flex h-full flex-col justify-center p-16">
          {@render problem()}
        </div>
      {:else if screenshot !== null}
        <img
          src={screenshot}
          alt="Static screenshot of the captured page"
          class="block w-full max-w-full"
        />
      {:else if hasCapture}
        <div class="flex h-full items-center justify-center">
          <p class="text-sm text-text-muted">The renderer returned no screenshot for this page.</p>
        </div>
      {/if}
    </div>
  </div>

  {#if inspector}
    <div
      class="min-w-0 border-t border-border-default lg:flex lg:min-h-0 lg:w-2/5 lg:flex-col lg:border-s lg:border-t-0"
    >
      {@render inspector()}
    </div>
  {/if}
</div>

<!-- The screenshot at full size: a reading panel that opens filling the screen by design, since a
     page image has nothing to gain from a window. -->
<ActionDialog bind:open={expanded} kind="reading" heading="Full Screenshot" expanded={true}>
  {#snippet fields()}
    {#if screenshot !== null}
      <img
        src={screenshot}
        alt="Static screenshot of the captured page, at full size"
        class="block w-full max-w-full"
      />
    {/if}
  {/snippet}
</ActionDialog>
