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
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import EventRail from "@magna-carta/design-system/event-rail";
  import type { EventRailEvent } from "@magna-carta/design-system/event-rail";
  import MeetingQualityMark from "./meeting-quality-mark.svelte";
  import { participantInitials } from "./meeting-tiles.ts";
  import type { ConnectionParticipantModel, UplinkModel } from "./meeting-connection.ts";
  import type { ConnectionQuality } from "$lib/meetings/client/connection-quality.ts";

  /**
   * How much of the wire's history the panel draws.
   *
   * The ring behind it is longer, and all of it would make a floating panel taller than the room it
   * floats over. What a reader wants here is the last thing that happened and what led to it.
   */
  const EVENTS_SHOWN = 10;

  let {
    uplink,
    participants,
    events,
  }: {
    uplink: UplinkModel;
    /** Everybody else in the room, in the order the roster names them. */
    participants: readonly ConnectionParticipantModel[];
    /** What has happened on the wire, oldest first. */
    events: readonly EventRailEvent[];
  } = $props();

  /** The words the quality mark is read with, so a row says it as well as showing it. */
  const QUALITY_WORD: Record<ConnectionQuality, string> = {
    good: "Good",
    fair: "Fair",
    poor: "Poor",
    unknown: "Not measured yet",
  };

  /** A picture's size, as a reader would say it out loud. */
  function resolution(width: number | null, height: number | null): string | null {
    if (width === null || height === null) return null;
    return `${width} by ${height}`;
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
  const lossText = $derived(share(uplink.lossFraction));
  const roundTripText = $derived(milliseconds(uplink.roundTripMilliseconds));
  const shown = $derived(events.slice(Math.max(0, events.length - EVENTS_SHOWN)));
</script>

<Popover.Root>
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

  <Popover.Content class="flex flex-col gap-16" style="inline-size: var(--mc-size-popover)">
    <div class="flex flex-col gap-4">
      <h2 class="text-sm font-medium">Connection Details</h2>
      <p class="text-xs text-text-muted">
        What this page is sending and receiving at the moment. None of it is recorded, and none
        of it reaches the meeting's own record.
      </p>
    </div>

    <DefinitionList.Root>
      <DefinitionList.Row term="Quality">
        <span class="flex items-center gap-8">
          <MeetingQualityMark quality={uplink.quality} />
          {QUALITY_WORD[uplink.quality]}
        </span>
      </DefinitionList.Row>
      <DefinitionList.Row term="Picture" empty={resolutionText === null}>
        {#if resolutionText !== null}
          <span class="tabular-nums">{resolutionText}</span>
        {/if}
      </DefinitionList.Row>
      <!-- The camera is offered in three sizes and the room asks for one of them; which one
           it is asking for is the difference between a soft picture and a broken connection. -->
      <DefinitionList.Row term="Layer" empty={uplink.rid === null}>
        {#if uplink.rid !== null}
          {uplink.rid}
        {/if}
      </DefinitionList.Row>
      <DefinitionList.Row term="Going Out" empty={rateText === null}>
        {#if rateText !== null}
          <span class="tabular-nums">{rateText}</span>
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
      {:else}
        <li class="text-sm text-text-muted">
          Nobody else is in the room, so nothing is coming in.
        </li>
      {/each}
    </ul>

    <EventRail
      events={shown}
      label="What has happened on this connection"
      emptyMessage="Nothing has happened on this connection yet."
      note="The last few moments only, kept in this tab while it is open."
    />
  </Popover.Content>
</Popover.Root>
