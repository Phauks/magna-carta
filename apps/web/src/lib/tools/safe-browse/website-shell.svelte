<script lang="ts">
  /*
   * The browser-shell for a safe-browse capture. The shell's top bar IS the page's one entry: the
   * address field, the Load Website action, back/forward/refresh over the page's capture history,
   * a copy control for the address, and the Static/Live view toggle (Live is the interactive
   * remote-browsing capability, rendered disabled with the Soon mark until it is served). The
   * frame renders from page load and holds its shape through every state: the viewport shows a
   * calm placeholder while the isolated remote browser works, the finished screenshot only when a
   * capture has completed (nothing partial ever appears), and a failed capture's alert inside the
   * same viewport so the layout never collapses. Everything in the frame is inert — the screenshot
   * is a plain <img> over a data: URL, and the landed address is text, never an anchor.
   */
  import type { Snippet } from "svelte";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import CornerDownRight from "@lucide/svelte/icons/corner-down-right";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";

  let {
    address = $bindable(""),
    capturing = false,
    canSubmit = false,
    invalidHint = null,
    canGoBack = false,
    canGoForward = false,
    canRefresh = false,
    landedUrl = null,
    screenshot = null,
    hasCapture = false,
    onsubmit,
    onback,
    onforward,
    onrefresh,
    problem,
  }: {
    /** The address in the entry field; the page binds and reads it. */
    address?: string;
    /** Whether the isolated browser is still rendering — the viewport holds its placeholder. */
    capturing?: boolean;
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
    /** Whether a completed capture is on show (decides the no-screenshot line). */
    hasCapture?: boolean;
    /** Starts a capture of the entered address; the shell has already prevented the submit. */
    onsubmit?: () => void;
    onback?: () => void;
    onforward?: () => void;
    onrefresh?: () => void;
    /** A failed capture's alert, rendered inside the viewport so the frame holds. */
    problem?: Snippet;
  } = $props();

  const addressInputIdentifier = $props.id();
  const invalidHintIdentifier = `${addressInputIdentifier}-invalid`;

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  function submit(event: SubmitEvent) {
    event.preventDefault();
    onsubmit?.();
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      copied = true;
      if (copyTimer !== null) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1500);
    } catch {
      // The clipboard is unavailable here; nothing was copied, so nothing gets confirmed.
    }
  }
</script>

<div class="overflow-hidden rounded-md border border-border-default">
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
      <Button variant="secondary" size="sm" aria-pressed="true">Static</Button>
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
      aria-label={copied ? "Copied" : "Copy Address"}
      disabled={address.trim() === ""}
      onclick={copyAddress}
    >
      {#if copied}
        <Check class="size-16" aria-hidden="true" />
      {:else}
        <Copy class="size-16" aria-hidden="true" />
      {/if}
    </Button>
    <Button type="submit" variant="primary" disabled={!canSubmit}>
      {capturing ? "Capturing…" : "Load Website"}
    </Button>
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
      <span class="min-w-0 truncate font-mono text-xs text-text-default" title={landedUrl}>
        {landedUrl}
      </span>
      <Badge variant="warning" class="shrink-0">Different Site</Badge>
    </div>
  {/if}

  <div class="mc-scrollbar aspect-video overflow-y-auto bg-surface-sunken">
    {#if capturing}
      <div class="flex h-full flex-col items-center justify-center gap-8">
        <Skeleton class="h-16 w-96" />
        <p class="text-sm text-text-muted">Rendering in the isolated browser…</p>
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
