<script lang="ts">
  /*
   * The tiles, arranged. A working surface: it takes the height it is given and keeps it, so the
   * room does not reflow as people join and leave.
   *
   * EVERY PICTURE KEEPS THE CAMERA'S SHAPE. The gallery measures the space it has and draws each tile
 * as large as it can at sixteen by nine (meeting-layout.ts), so two people on a laptop sit side by
 * side rather than as two tall strips. In speaker view the others are a strip along the top.
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
  import { arrangeTiles, TILE_ASPECT } from "./meeting-layout.ts";
  import { isOwnCamera, type MeetingTileModel } from "./meeting-tiles.ts";
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
    mirrorSelf = false,
    onPin,
    hostMenu,
    onPictureAttached,
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
    /** Draw this browser's own camera as a mirror shows it. The room receives it unflipped. */
    mirrorSelf?: boolean;
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
    /** Told where a tile started a new picture, for the diagnostics: the large slot, the strip or the gallery. */
    onPictureAttached?: (where: "large picture" | "strip" | "gallery") => void;
  } = $props();

  /** What takes the large slot, where anything does. */
  const large = $derived(sharedScreen ?? spotlight);
  /** Everything else, which is the strip under a large slot or the whole gallery without one. */
  const rest = $derived(
    large === null ? tiles : tiles.filter((tile) => tile.key !== large.key),
  );
  /** The space the large picture or the gallery has, as the browser last measured it. */
  let stageWidth = $state(0);
  let stageHeight = $state(0);
  /** The strip's height in pixels: room for a face and a name, never more than a fifth of a laptop. */
  const STRIP_HEIGHT = 112;
  const stripTileWidth = Math.round(STRIP_HEIGHT * TILE_ASPECT);
  /** The space between gallery tiles, which is the gap-16 the gallery is drawn with. */
  const GALLERY_GAP = 16;
  const galleryFit = $derived(arrangeTiles(rest.length, stageWidth, stageHeight, GALLERY_GAP));
  const largeFit = $derived(arrangeTiles(1, stageWidth, stageHeight, 0));
  const onFirstPage = $derived(page <= 0);
  const onLastPage = $derived(page >= pages - 1);
</script>

<!--
  One person, wherever they sit: the strip under a large slot, or the even gallery. Written once so
  the two arrangements cannot drift into offering different things on the same tile — a pin on one
  and none on the other is exactly the kind of difference nobody notices until somebody reports it.
-->
{#snippet personTile(tile: MeetingTileModel, size: string | undefined, sizing: string)}
  <MeetingTile
    onPictureAttached={() => onPictureAttached?.(large === null ? "gallery" : "strip")}
    class="min-h-0 {sizing}"
    style={size}
    mirrored={mirrorSelf && isOwnCamera(tile)}
    stream={tile.stream}
    name={tile.name}
    microphoneOff={tile.microphoneOff}
    speaking={tile.speaking}
    pinned={tile.pinned}
    videoPulled={tile.videoPulled}
    quality={tile.quality}
    hostRole={tile.hostRole}
    spotlighted={tile.spotlighted}
    handRaised={tile.handRaised}
    reactions={tile.reactions}
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
    <!-- Speaker view, or a share: a strip of everybody else along the top, and the large picture
         under it, fitted to the camera's shape rather than stretched to the room's. -->
    {#if rest.length > 0}
      <div
        class="mc-scrollbar flex shrink-0 justify-center gap-12 overflow-x-auto"
        style="block-size: {STRIP_HEIGHT}px"
      >
        {#each rest as tile (tile.key)}
          {@render personTile(tile, `inline-size: ${stripTileWidth}px; block-size: 100%`, "shrink-0")}
        {/each}
      </div>
    {/if}
    <div
      class="flex min-h-0 flex-1 items-center justify-center"
      bind:clientWidth={stageWidth}
      bind:clientHeight={stageHeight}
    >
      <MeetingTile
        class={largeFit.tileWidth > 0 ? "" : "h-full w-full"}
        style={largeFit.tileWidth > 0
          ? `inline-size: ${largeFit.tileWidth}px; block-size: ${largeFit.tileHeight}px`
          : undefined}
        stream={large.stream}
        name={large.name}
        microphoneOff={large.microphoneOff}
        speaking={large.speaking}
        pinned={large.pinned}
        videoPulled={large.videoPulled}
        quality={large.quality}
        hostRole={large.hostRole}
        spotlighted={large.spotlighted}
        handRaised={large.handRaised}
        reactions={large.reactions}
        mirrored={mirrorSelf && isOwnCamera(large)}
        fit={large.microphoneOff === null ? "contain" : "cover"}
        onPictureAttached={() => onPictureAttached?.("large picture")}
        {medium}
      >
        {#snippet menu()}
          {#if large.participantId !== null && !large.local}
            {@render hostMenu?.(large)}
          {/if}
        {/snippet}
      </MeetingTile>
    </div>
  {:else}
    <div
      class="flex min-h-0 flex-1 flex-wrap content-center items-center justify-center gap-16"
      bind:clientWidth={stageWidth}
      bind:clientHeight={stageHeight}
    >
      {#each rest as tile (tile.key)}
        {@render personTile(
          tile,
          galleryFit.tileWidth > 0
            ? `inline-size: ${galleryFit.tileWidth}px; block-size: ${galleryFit.tileHeight}px`
            : undefined,
          galleryFit.tileWidth > 0 ? "" : "aspect-video w-full",
        )}
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
