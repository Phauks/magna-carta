<script lang="ts">
  /*
   * The host's lobby panel under what the app's root gives it: the one Tooltip.Provider the
   * surfaces inside it read their delays from. A Tooltip.Root with no provider above it throws as
   * it mounts.
   *
   * IT ALSO HOLDS THE QUEUE, so a case can make somebody ARRIVE while a question is standing. That
   * is the one thing Deny All has to get right and the one thing a fixed prop cannot ask about:
   * `mount` takes a plain object, so a case that wants the door to move has to move it through
   * something reactive, and this is it.
   */
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import MeetingLobbyPanel from "$lib/meetings/meeting-lobby-panel.svelte";
  import type { ComponentProps } from "svelte";

  type PanelProps = ComponentProps<typeof MeetingLobbyPanel>;

  let {
    waiting,
    registerArrivals,
    ...rest
  }: PanelProps & {
    /** Handed the way to change who is at the door, once, as the harness mounts. */
    registerArrivals?: (arrive: (waiting: PanelProps["waiting"]) => void) => void;
  } = $props();

  /** Who is at the door once somebody has arrived. Null while the list is the one passed in. */
  let arrived = $state<PanelProps["waiting"] | null>(null);
  const atTheDoor = $derived(arrived ?? waiting);

  $effect(() => {
    registerArrivals?.((next) => {
      arrived = next;
    });
  });
</script>

<Tooltip.Provider>
  <MeetingLobbyPanel {...rest} waiting={atTheDoor} />
</Tooltip.Provider>
