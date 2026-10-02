<script lang="ts">
  /*
   * The reactions control in the band: one press, one frame, menu closed.
   *
   * A REACTION IS A THING YOU THROW AND NOT A MODE YOU ENTER, which decides the whole shape. The
   * trigger opens a single row of the six, each item carrying its own WORD as its accessible name,
   * and choosing one sends it and shuts the menu. A control that stayed open would invite somebody
   * to sit in it, and the one thing a firm's meeting does not need is a reaction held down.
   *
   * THE SIX ARE THE PROTOCOL'S, NOT THIS FILE'S. The vocabulary is closed on the wire — a name
   * outside it does not parse — so the menu is drawn by walking that list rather than by writing
   * six items out, and a seventh is a protocol change rather than a line here.
   *
   * THE FACE ON THE TRIGGER IS THE ONE UNCLAIMED ONE. `smile` draws the control because it is not
   * one of the six and is not spoken for anywhere else in the product; a trigger wearing one of the
   * six would say the menu is about that one.
   */
  import Smile from "@lucide/svelte/icons/smile";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import MeetingReactionMark from "./meeting-reaction-mark.svelte";
  import {
    MEETING_REACTIONS,
    reactionWord,
    type MeetingReaction,
  } from "$lib/meetings/client/reactions.svelte.ts";

  let {
    onReact,
  }: {
    /** Throw one. The client paces it; nothing here counts seconds. */
    onReact: (name: MeetingReaction) => void;
  } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={buttonClasses({ variant: "ghost", size: "icon" })}
    aria-label="React"
  >
    <Smile class="size-16" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <!-- One ROW rather than a column: six glyphs read as a palette, where six stacked rows read as a
       menu of settings. The words are the accessible names, so a reader hears what each one means
       rather than which picture it is. -->
  <DropdownMenu.Content align="end" class="flex flex-row gap-4">
    {#each MEETING_REACTIONS as name (name)}
      <DropdownMenu.Item aria-label={reactionWord(name)} onSelect={() => onReact(name)}>
        <MeetingReactionMark {name} />
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
