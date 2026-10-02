<script lang="ts">
  /*
   * The tiles, arranged. A working surface: it takes the height it is given and keeps it, so the
   * room does not reflow as people join and leave.
   *
   * ONE THING GETS THE LARGE SLOT. A screen share, first: everything a meeting is for while
   * somebody is sharing is in that picture — the draft, the exhibit, the spreadsheet — so the faces
   * step down to a strip and the share takes the rest. Failing that, the speaker, where the member
   * has asked for speaker view. With neither there is no large slot: equal tiles, because the room
   * has no view of itself that is more important than another.
   *
   * THE PAGE CONTROLS ARE THE GALLERY'S OWN, and they appear only when the room is larger than one
   * page. A three-person meeting carries no paging chrome at all, which is most meetings.
   */
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Button from "@magna-carta/design-system/button";
  import MeetingTile from "./meeting-tile.svelte";
  import type { MeetingTileModel } from "./meeting-tiles.ts";
  import type { MeetingMedium } from "@magna-carta/meeting-protocol/types";
  import type { Snippet } from "svelte";

  let {
    tiles,
    sharedScreen = null,
    spotlight = null,
    medium = "video",
    page = 0,
    pages = 1,
    roomSize = 0,
    onPage,
    onPin,
    hostMenu,
  }: {
    /** The people on this page, this browser's own preview first. */
    tiles: readonly MeetingTileModel[];
    /** The screen being shared, where one is. It takes the large slot ahead of everything. */
    sharedScreen?: MeetingTileModel | null;
    /** The speaker, where the member asked for speaker view. Null in the even gallery. */
    spotlight?: MeetingTileModel | null;
    /**
     * What the room carries. It reaches every tile from here rather than riding on each one: it is
     * a fact about the ROOM, and a grid whose tiles could disagree about it would be a call with
     * one person's camera in it.
     */
    medium?: MeetingMedium;
    /** Which page of the room is showing, counted from zero. */
    page?: number;
    /** How many pages the room takes. */
    pages?: number;
    /** Everybody in the room, this browser included, for the count under the tiles. */
    roomSize?: number;
    onPage?: (page: number) => void;
    /** Pin or unpin somebody. Absent where pinning is not offered. */
    onPin?: (participantId: string) => void;
    /**
     * The host's own menu for one tile, where the member reading is running the meeting.
     *
     * The grid does not decide who gets one: it is handed a snippet and renders it wherever a person
     * is drawn, so the one place the question "may this member act on that one" is answered is the
     * screen that holds the roles. Absent for everybody else.
     */
    hostMenu?: Snippet<[MeetingTileModel]>;
  } = $props();

  /** What takes the large slot, where anything does. */
  const large = $derived(sharedScreen ?? spotlight);
  /** Everything else, which is the strip under a large slot or the whole gallery without one. */
  const rest = $derived(
    large === null ? tiles : tiles.filter((tile) => tile.key !== large.key),
  );
  const onFirstPage = $derived(page <= 0);
  const onLastPage = $derived(page >= pages - 1);
</script>

<!--
  One person, wherever they sit: the strip under a large slot, or the even gallery. Written once so
  the two arrangements cannot drift into offering different things on the same tile — a pin on one
  and none on the other is exactly the kind of difference nobody notices until somebody reports it.
-->
{#snippet personTile(tile: MeetingTileModel)}
  <MeetingTile
    class="min-h-0"
    stream={tile.stream}
    name={tile.name}
    microphoneOff={tile.microphoneOff}
    speaking={tile.speaking}
    pinned={tile.pinned}
    videoPulled={tile.videoPulled}
    quality={tile.quality}
    hostRole={tile.hostRole}
    spotlighted={tile.spotlighted}
    onPin={onPin === undefined || tile.participantId === null || tile.local
      ? undefined
      : () => onPin(tile.participantId ?? "")}
    {medium}
  >
    {#snippet menu()}
      <!-- A screen share has nobody to act on, and nobody acts on themselves through this: leaving
           is how a person leaves. -->
      {#if tile.participantId !== null && !tile.local}
        {@render hostMenu?.(tile)}
      {/if}
    {/snippet}
  </MeetingTile>
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-16">
  {#if large !== null}
    <MeetingTile
      class="min-h-0 flex-1"
      stream={large.stream}
      name={large.name}
      microphoneOff={large.microphoneOff}
      speaking={large.speaking}
      pinned={large.pinned}
      videoPulled={large.videoPulled}
      quality={large.quality}
      hostRole={large.hostRole}
      spotlighted={large.spotlighted}
      {medium}
    >
      {#snippet menu()}
        {#if large.participantId !== null && !large.local}
          {@render hostMenu?.(large)}
        {/if}
      {/snippet}
    </MeetingTile>
    <div
      class="mc-scrollbar grid min-h-0 shrink-0 basis-1/4 auto-rows-fr grid-cols-3 gap-16 overflow-y-auto sm:grid-cols-4 xl:grid-cols-6"
    >
      {#each rest as tile (tile.key)}
        {@render personTile(tile)}
      {/each}
    </div>
  {:else}
    <div class="grid min-h-0 flex-1 auto-rows-fr gap-16 sm:grid-cols-2 xl:grid-cols-3">
      {#each rest as tile (tile.key)}
        {@render personTile(tile)}
      {/each}
    </div>
  {/if}

  {#if pages > 1}
    <div class="flex shrink-0 items-center justify-between gap-8">
      <span class="text-sm text-text-muted tabular-nums">
        Showing {tiles.length} of {roomSize}
      </span>
      <div class="flex items-center gap-8">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous page"
          disabled={onFirstPage}
          onclick={() => onPage?.(page - 1)}
        >
          <ChevronLeft class="size-16" aria-hidden="true" />
        </Button>
        <span class="text-sm text-text-muted tabular-nums">Page {page + 1} of {pages}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next page"
          disabled={onLastPage}
          onclick={() => onPage?.(page + 1)}
        >
          <ChevronRight class="size-16" aria-hidden="true" />
        </Button>
      </div>
    </div>
  {/if}
</div>
