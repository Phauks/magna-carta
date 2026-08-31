<script lang="ts">
  /*
   * The browser-shell for a safe-browse capture. The shell's top bar IS the page's one entry: the
   * address field, the Load Website action, back/forward/refresh over the page's capture history,
   * copy controls for the entered and landed addresses, screenshot actions (download, full
   * screen), and the Static/Live view toggle (Live is the interactive remote-browsing capability,
   * rendered disabled with the Soon mark until it is served). The whole viewer is ONE framed unit:
   * the browser window on the left and the caller's inspector panel (the information tabs)
   * attached on the right, joined by a shared hairline so the two halves never read as separate
   * cards; on narrow screens the panel stacks beneath the viewport inside the same frame.
   *
   * The frame renders from page load and holds its shape through every state: while the isolated
   * remote browser works the viewport names the address being captured, holds an indeterminate
   * placeholder bar with a live elapsed readout, and states what the service is doing overall (the
   * endpoint is one request, so no per-stage checklist is pretended); the finished screenshot
   * appears only when a capture has completed (nothing partial), and a failed capture's alert
   * renders inside the same viewport so the layout never collapses. Everything in the frame is
   * inert — the screenshot is a plain <img> over a data: URL (full-screen included), and the
   * landed address is text, never an anchor.
   */
  import type { Snippet } from "svelte";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import CornerDownRight from "@lucide/svelte/icons/corner-down-right";
  import Download from "@lucide/svelte/icons/download";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";

  let {
    address = $bindable(""),
    capturing = false,
    capturingUrl = null,
    canSubmit = false,
    invalidHint = null,
    canGoBack = false,
    canGoForward = false,
    canRefresh = false,
    landedUrl = null,
    screenshot = null,
    downloadFilename = null,
    hasCapture = false,
    onsubmit,
    onback,
    onforward,
    onrefresh,
    problem,
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
    /** Whether the capture history holds an entry behind the current one. */
    canGoBack?: boolean;
    /** Whether the capture history holds an entry ahead of the current one. */
    canGoForward?: boolean;
    /** Whether there is a current capture to re-capture. */
    canRefresh?: boolean;
    /** The address the capture landed on, only when it differs from the entered host. */
    landedUrl?: string | null;
    /** The finished screenshot as an <img> source, or null when the renderer returned none. */
    screenshot?: string | null;
    /** What the screenshot saves as when downloaded, or null when there is none to save. */
    downloadFilename?: string | null;
    /** Whether a completed capture is on show (decides the no-screenshot line). */
    hasCapture?: boolean;
    /** Starts a capture of the entered address; the shell has already prevented the submit. */
    onsubmit?: () => void;
    onback?: () => void;
    onforward?: () => void;
    onrefresh?: () => void;
    /** A failed capture's alert, rendered inside the viewport so the frame holds. */
    problem?: Snippet;
    /** The attached inspector panel — the frame's right half, stacking beneath on narrow screens. */
    inspector?: Snippet;
  } = $props();

  const addressInputIdentifier = $props.id();
  const invalidHintIdentifier = `${addressInputIdentifier}-invalid`;

  let copiedAddress = $state(false);
  let addressCopyTimer: ReturnType<typeof setTimeout> | null = null;
  let copiedLanded = $state(false);
  let landedCopyTimer: ReturnType<typeof setTimeout> | null = null;
  let expanded = $state(false);
  let elapsedSeconds = $state(0);

  // The live elapsed readout beside the loading line. One interval per capture, torn down with
  // the state — the endpoint reports no progress, so seconds elapsed is the one honest live fact.
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

  async function copyLandedUrl() {
    if (landedUrl === null) return;
    try {
      await navigator.clipboard.writeText(landedUrl);
      copiedLanded = true;
      if (landedCopyTimer !== null) clearTimeout(landedCopyTimer);
      landedCopyTimer = setTimeout(() => (copiedLanded = false), 1500);
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

<div class="flex flex-col overflow-hidden rounded-md border border-border-default lg:flex-row">
  <div class="flex min-w-0 flex-col lg:w-3/5">
    <form
      onsubmit={submit}
      class="flex min-w-0 flex-wrap items-center gap-8 border-b border-border-default bg-surface-sunken px-12 py-8"
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
      <div class="flex items-center gap-4" role="group" aria-label="View Mode">
        <Button variant="primary" size="sm" aria-pressed="true">Static</Button>
        <SoonAffordance reason="the interactive remote-browsing service">
          {#snippet control(soon)}
            <Button variant="ghost" size="sm" aria-pressed="false" {...soon}>Live</Button>
          {/snippet}
        </SoonAffordance>
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
        <Button
          variant="ghost"
          size="icon"
          aria-label="Download Image"
          disabled={screenshot === null || downloadFilename === null}
          onclick={downloadScreenshot}
        >
          <Download class="size-16" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="View Full Screen"
          disabled={screenshot === null}
          onclick={() => (expanded = true)}
        >
          <Maximize2 class="size-16" aria-hidden="true" />
        </Button>
      </div>
    </form>

    {#if invalidHint !== null}
      <p
        id={invalidHintIdentifier}
        class="border-b border-border-default px-12 py-8 text-xs text-text-muted"
      >
        {invalidHint}
      </p>
    {/if}

    {#if landedUrl !== null}
      <div
        class="flex min-w-0 items-center gap-8 border-b border-border-default bg-surface-sunken px-12 py-8"
      >
        <CornerDownRight class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate font-mono text-xs text-text-default" title={landedUrl}>
          {landedUrl}
        </span>
        <Badge variant="warning" class="shrink-0">Different Site</Badge>
        <Button
          variant="ghost"
          size="icon"
          aria-label={copiedLanded ? "Copied" : "Copy Landed Address"}
          onclick={copyLandedUrl}
        >
          {#if copiedLanded}
            <Check class="size-16" aria-hidden="true" />
          {:else}
            <Copy class="size-16" aria-hidden="true" />
          {/if}
        </Button>
      </div>
    {/if}

    <div class="mc-scrollbar aspect-video grow overflow-y-auto bg-surface-sunken">
      {#if capturing}
        <div class="flex h-full flex-col items-center justify-center gap-8 p-16">
          {#if capturingUrl !== null}
            <p
              class="max-w-full truncate font-mono text-sm text-text-default"
              title={capturingUrl}
            >
              {capturingUrl}
            </p>
          {/if}
          <Skeleton class="h-8 w-1/2" />
          <p class="text-sm text-text-muted">
            Opening the address in the isolated remote browser…
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
    <div class="min-w-0 border-t border-border-default lg:w-2/5 lg:border-s lg:border-t-0">
      {@render inspector()}
    </div>
  {/if}
</div>

<Dialog.Root bind:open={expanded}>
  <Dialog.Content class="h-full w-full max-w-full">
    <Dialog.Title>Full Screenshot</Dialog.Title>
    <div class="mc-scrollbar min-h-0 flex-1 overflow-auto">
      {#if screenshot !== null}
        <img
          src={screenshot}
          alt="Static screenshot of the captured page, at full size"
          class="block w-full max-w-full"
        />
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
