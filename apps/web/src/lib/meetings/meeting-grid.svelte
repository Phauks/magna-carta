<script lang="ts">
  /*
   * The tiles, arranged. A working surface: it takes the height it is given and keeps it, so the
   * room does not reflow as people join and leave.
   *
   * ONE THING GETS THE LARGE SLOT, and it is a screen share. Everything a meeting is for while
   * somebody is sharing is in that picture — the draft, the exhibit, the spreadsheet — so the faces
   * step down to a strip and the share takes the rest. With nothing shared there is no large slot:
   * equal tiles, because the room has no view of itself that is more important than another.
   */
  import MeetingTile from "./meeting-tile.svelte";
  import type { MeetingTileModel } from "./meeting-tiles.ts";

  let {
    tiles,
    sharedScreen = null,
  }: {
    /** Everybody in the room, this browser's own preview first. */
    tiles: readonly MeetingTileModel[];
    /** The screen being shared, where one is. It takes the large slot. */
    sharedScreen?: MeetingTileModel | null;
  } = $props();
</script>

{#if sharedScreen !== null}
  <div class="flex h-full min-h-0 flex-col gap-16">
    <MeetingTile
      class="min-h-0 flex-1"
      stream={sharedScreen.stream}
      name={sharedScreen.name}
      local={sharedScreen.local}
      microphoneOff={sharedScreen.microphoneOff}
    />
    <div
      class="mc-scrollbar grid min-h-0 shrink-0 basis-1/4 auto-rows-fr grid-cols-3 gap-16 overflow-y-auto sm:grid-cols-4 xl:grid-cols-6"
    >
      {#each tiles as tile (tile.key)}
        <MeetingTile
          class="min-h-0"
          stream={tile.stream}
          name={tile.name}
          local={tile.local}
          microphoneOff={tile.microphoneOff}
        />
      {/each}
    </div>
  </div>
{:else}
  <div class="grid h-full min-h-0 auto-rows-fr gap-16 sm:grid-cols-2 xl:grid-cols-3">
    {#each tiles as tile (tile.key)}
      <MeetingTile
        class="min-h-0"
        stream={tile.stream}
        name={tile.name}
        local={tile.local}
        microphoneOff={tile.microphoneOff}
      />
    {/each}
  </div>
{/if}
