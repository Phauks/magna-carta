<script lang="ts">
  /*
   * The matter's Magnus section: what has been asked about this file.
   *
   * It draws NO header and NO way back. The matter's masthead and its section strip are already on
   * screen, and a second header inside a section is exactly the drift the shared screen header
   * exists to prevent.
   *
   * The conversations are filtered to this matter and a new one is kept on it; the screen offers no
   * matter picker, because on this screen there is nothing to pick. What the matter link does is
   * scope the RECORD: the transcript is kept on the matter's file. It puts none of the matter's
   * content into anything the assistant is sent, which is what the line above the composer says and
   * why that line is the most load-bearing sentence on the screen.
   *
   * The matter header's create control keeps declining here (sections.ts): the matter's New makes
   * the matter's records, and a conversation is not one. Starting a conversation is a gesture inside
   * the surface, where the composer is.
   *
   * A SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has no
   * firm behind it and therefore nothing to read; it says so rather than showing an empty surface.
   */
  import MagnusSurface from "$lib/magnus/magnus-surface.svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");
</script>

<svelte:head>
  <title>Magnus · {matter.title} · Magna Carta</title>
</svelte:head>

<MagnusSurface
  subject={matter.id}
  matterId={matter.id}
  rail="switcher"
  {isSample}
  emptyTitle="Nothing Asked About This Matter"
  emptyDescription="No conversation is on this matter yet. Type a question below to start one."
/>
