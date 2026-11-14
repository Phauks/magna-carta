<script lang="ts">
  /*
   * What this page's connection is doing, in numbers, behind the Connection control in the band.
   *
   * IT IS A POPOVER AND NOT A PANEL OVER THE ROOM, and that is a judgment rather than a shortcut.
   * The product's two modal shells answer an act asked of a reader (ActionDialog) and a record read
   * and changed (RecordWindow); this is neither. It is context anchored to the control that opens
   * it, read while the meeting carries on behind it — and a scrim over a room somebody is watching
   * would hide the very thing the numbers are about.
   *
   * NOTHING IN IT IS RECORDED. The panel says so, once, because a reader looking at packet loss
   * beside their colleagues' names will reasonably wonder where it is going. The answer is nowhere:
   * the numbers live in this tab's memory for as long as this tab is open.
   *
   * IT TAKES MODELS, NOT THE CLIENT. Everything here is a plain record the room screen projects
   * (meeting-connection.ts), so the panel can be rendered from a fixed set of numbers without a
   * peer connection anywhere near it — the same rule the grid and the roster are built to.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import ClipboardCopy from "@lucide/svelte/icons/clipboard-copy";
  import Button from "@magna-carta/design-system/button";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import MeetingQualityMark from "./meeting-quality-mark.svelte";
  import { participantInitials } from "./meeting-tiles.ts";
  import {
    CAMERA_LAYER_WORDS,
    type ConnectionParticipantModel,
    type UplinkModel,
  } from "./meeting-connection.ts";
  import type { ConnectionQuality } from "$lib/meetings/client/connection-quality.ts";

  let {
    uplink,
    participants,
    site = null,
    onOpen,
    onCopy,
  }: {
    uplink: UplinkModel;
    /** Everybody else in the room, in the order the roster names them. */
    participants: readonly ConnectionParticipantModel[];
    /** The Cloudflare site serving the meeting, by its code, where it is known. */
    site?: string | null;
    /** Told when the panel opens, so the screen can read what only an open panel shows. */
    onOpen?: () => void;
    /**
     * Copy the last few minutes of numbers as text to paste to whoever is helping. Absent where the
     * screen does not offer it.
     */
    onCopy?: () => void;
  } = $props();

  /** The words the quality mark is read with, so a row says it as well as showing it. */
  const QUALITY_WORD: Record<ConnectionQuality, string> = {
    good: "Good",
    fair: "Fair",
    poor: "Poor",
    unknown: "Not measured yet",
  };

  /**
   * What each reading means, so "Good" is not a word on its own. The edges are the ones
   * `connection-quality.ts` judges by.
   */
  const QUALITY_MEANING: Record<ConnectionQuality, string> = {
    good: "Under 2% of packets lost and a round trip under 200 ms.",
    fair: "Some packets lost (2 to 8%) or a round trip of 200 to 400 ms: the picture may soften.",
    poor: "Over 8% of packets lost or a round trip over 400 ms: expect freezes and broken sound.",
    unknown: "Measured a few seconds after you join.",
  };

  /** A picture's size, as a reader would say it out loud. */
  function resolution(width: number | null, height: number | null): string | null {
    if (width === null || height === null) return null;
    return `${width} by ${height} pixels`;
  }

  /**
   * What is going out, at the scale the number is actually in: a camera sends hundreds of kilobits
   * to a few megabits, and a figure in bits would be eight digits nobody reads.
   */
  function rate(bitsPerSecond: number | null): string | null {
    if (bitsPerSecond === null) return null;
    if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbit/s`;
    return `${Math.round(bitsPerSecond / 1000)} kbit/s`;
  }

  /** A share of packets, as a percentage with one decimal — one in a thousand is a real answer. */
  function share(fraction: number | null): string | null {
    return fraction === null ? null : `${(fraction * 100).toFixed(1)}%`;
  }

  function milliseconds(measured: number | null): string | null {
    return measured === null ? null : `${Math.round(measured)} ms`;
  }

  const resolutionText = $derived(resolution(uplink.frameWidth, uplink.frameHeight));
  const rateText = $derived(rate(uplink.bitsPerSecond));
  const uploadText = $derived(rate(uplink.uploadBitsPerSecond));
  const downloadText = $derived(rate(uplink.downloadBitsPerSecond));
  const layerText = $derived(
    uplink.rid === null ? null : (CAMERA_LAYER_WORDS[uplink.rid] ?? uplink.rid),
  );
  const serverText = $derived.by(() => {
    const server = uplink.server;
    const where = site === null ? "Cloudflare" : `Cloudflare, site ${site}`;
    if (server === null) return site === null ? null : where;
    const route = server.relayed ? "through a relay" : "direct";
    const transport = server.protocol === null ? "" : `, ${server.protocol.toUpperCase()}`;
    return `${where} (${route}${transport})`;
  });
  const lossText = $derived(share(uplink.lossFraction));
  const roundTripText = $derived(milliseconds(uplink.roundTripMilliseconds));
</script>

<Popover.Root onOpenChange={(open) => (open ? onOpen?.() : undefined)}>
  <!-- The hover names the control and nothing else, like every control in this band. The tooltip
       and the popover share ONE button through the tooltip trigger's child snippet; two elements
       would be two controls. The mark itself is the glyph, so the band says how the connection is
       before anybody presses it; it is hidden from a reader because the control already has a
       name, and the same mark is on every tile with its own words. -->
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Popover.Trigger
          {...props}
          class={buttonClasses({ variant: "ghost", size: "icon" })}
          aria-label="Connection details"
        >
          <MeetingQualityMark quality={uplink.quality} decorative />
        </Popover.Trigger>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="top">Connection</Tooltip.Content>
  </Tooltip.Root>

  <!-- WIDE AND SHORT. Two columns, this browser's own numbers on the left and the room on the right,
       each scrolling on its own, so the panel never runs off the top of a laptop screen. -->
  <Popover.Content
    class="flex flex-col gap-16"
    style="inline-size: min(var(--mc-size-record-pane), calc(100vw - var(--mc-size-modal-gutter) * 2)); max-block-size: min(var(--bits-floating-available-height), 70vh)"
  >
    <div class="flex flex-col gap-4">
      <h2 class="text-sm font-medium">Connection Details</h2>
      <p class="text-xs text-text-muted">
        What this page is sending and receiving at the moment. None of it is recorded, and none
        of it reaches the meeting's own record.
      </p>
    </div>

    <div
      class="grid min-h-0 grid-cols-1 gap-24 {participants.length > 0 ? 'sm:grid-cols-2' : ''}"
    >
    <div class="mc-scrollbar flex min-h-0 flex-col gap-16 overflow-y-auto">
    <DefinitionList.Root>
      <DefinitionList.Row term="Quality">
        <span class="flex flex-col gap-4">
          <span class="flex items-center gap-8">
            <MeetingQualityMark quality={uplink.quality} />
            {QUALITY_WORD[uplink.quality]}
          </span>
          <span class="text-xs text-text-muted">{QUALITY_MEANING[uplink.quality]}</span>
        </span>
      </DefinitionList.Row>
      <DefinitionList.Row term="Server" empty={serverText === null}>
        {#if serverText !== null}
          <span class="flex flex-col gap-4">
            {serverText}
            {#if uplink.server?.address}
              <span class="text-xs text-text-muted tabular-nums">{uplink.server.address}</span>
            {/if}
          </span>
        {/if}
      </DefinitionList.Row>
      <DefinitionList.Row term="Picture" empty={resolutionText === null}>
        {#if resolutionText !== null}
          <span class="tabular-nums">{resolutionText}</span>
        {/if}
      </DefinitionList.Row>
      <!-- The camera is sent in three sizes so each viewer gets the one their tile needs; this is
           the size shown above, and its own rate. -->
      <DefinitionList.Row term="Camera Size" empty={layerText === null}>
        {#if layerText !== null}
          <span class="flex flex-col gap-4">
            <span>
              {layerText}{#if rateText !== null}, <span class="tabular-nums">{rateText}</span>{/if}
            </span>
            <span class="text-xs text-text-muted">
              Your camera is sent at full, half and quarter size, and each person receives the size
              their screen shows you at.
            </span>
          </span>
        {/if}
      </DefinitionList.Row>
      <DefinitionList.Row term="Upload" empty={uploadText === null}>
        {#if uploadText !== null}
          <span class="tabular-nums">{uploadText}</span>
        {/if}
      </DefinitionList.Row>
      <DefinitionList.Row term="Download" empty={downloadText === null}>
        {#if downloadText !== null}
          <span class="tabular-nums">{downloadText}</span>
        {/if}
      </DefinitionList.Row>
      <DefinitionList.Row term="Packets Lost" empty={lossText === null}>
        {#if lossText !== null}
          <span class="tabular-nums">{lossText}</span>
        {/if}
      </DefinitionList.Row>
      <DefinitionList.Row term="Round Trip" empty={roundTripText === null}>
        {#if roundTripText !== null}
          <span class="tabular-nums">{roundTripText}</span>
        {/if}
      </DefinitionList.Row>
    </DefinitionList.Root>



    {#if onCopy !== undefined}
      <!-- For a stutter that has already passed: the copy covers the last few minutes, frame by
           frame, so it still holds what the reader saw. Numbers only, never a name. -->
      <Button variant="secondary" onclick={onCopy}>
        <ClipboardCopy class="size-16" aria-hidden="true" />
        Copy Diagnostics
      </Button>
    {/if}
    </div>

    {#if participants.length > 0}
    <div class="mc-scrollbar flex min-h-0 flex-col gap-16 overflow-y-auto">
    <!-- The people, not the tiles: a colleague whose voice is being pulled while their
         picture is not is still somebody whose connection can be answered for. -->
    <ul class="flex flex-col gap-8">
      {#each participants as participant (participant.participantId)}
        <li class="flex items-center gap-8">
          <Avatar.Root>
            <Avatar.Fallback>{participantInitials(participant.name)}</Avatar.Fallback>
          </Avatar.Root>
          <span class="min-w-0 flex-1 truncate text-sm" title={participant.name}>
            {participant.name}
          </span>
          <span class="text-sm text-text-muted">{QUALITY_WORD[participant.quality]}</span>
          <MeetingQualityMark quality={participant.quality} />
        </li>
      {/each}
    </ul>
    </div>
    {/if}
    </div>
  </Popover.Content>
</Popover.Root>
