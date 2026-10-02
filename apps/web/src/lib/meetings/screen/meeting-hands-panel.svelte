<script lang="ts" module>
  /** One hand in the queue, as the room screen resolves it. */
  export interface RaisedHandRow {
    readonly participantId: string;
    /** Who this is, as the roster states them. */
    readonly name: string;
    /** Whether the room says their microphone is off, which is what Ask to Unmute is for. */
    readonly muted: boolean;
  }
</script>

<script lang="ts">
  /*
   * The queue: who wants the floor, in the order they asked for it.
   *
   * IT IS A READING PANEL, on the waiting room's precedent and for its reason. A host opens it to
   * find out who is waiting at least as often as to act on one of them, so the action bar carries
   * only the way out and each step is offered in place, on the row it is about.
   *
   * IT IS OPENED FROM A CONTROL OF ITS OWN RATHER THAN FROM THE HOST MENU, and the count is why: a
   * host running a meeting learns somebody wants the floor by SEEING the number, and a count inside
   * a menu is a person with their hand up for ten minutes. The lobby's own control makes the same
   * argument about the same corner of the screen.
   *
   * THE ORDER IS THE ROOM'S AND THE SORT IS THE CLIENT'S. The room stamps the instant each hand
   * went up and relays it on the roster; the browser sorts. A room of three hundred must not be
   * asked to keep a sorted list in storage and rewrite it on every change — the same division the
   * subscription policy already holds.
   *
   * TWO ACTS PER ROW, AND ASK TO UNMUTE LEADS. A raised hand almost always wants the floor, and the
   * floor is a microphone; lowering it without giving it to anybody is the other answer and sits
   * beside it in the quieter register.
   */
  import Hand from "@lucide/svelte/icons/hand";
  import MicOff from "@lucide/svelte/icons/mic-off";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Button from "@magna-carta/design-system/button";
  import { participantInitials } from "./meeting-tiles.ts";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";

  let {
    open = $bindable(false),
    subject,
    hands,
    onAskToUnmute,
    onLowerHand,
    onLowerAll,
  }: {
    open?: boolean;
    /** Which meeting this is about, named once. */
    subject: RecordSubject;
    /** The queue, already in the order the hands went up. */
    hands: readonly RaisedHandRow[];
    /** Tap somebody on the shoulder. Nothing about their microphone changes until they answer. */
    onAskToUnmute: (participantId: string) => void;
    /** Put one hand down. The room tells the person whose it was. */
    onLowerHand: (participantId: string) => void;
    /**
     * Clear the floor. A host's OWN hand goes down with the rest — this exists so a host can start
     * the queue again, which is the opposite of what mute-all exists for.
     */
    onLowerAll: () => void;
  } = $props();
</script>

<ActionDialog bind:open kind="reading" heading="Raised Hands" subtitle={subject} width="narrow">
  {#snippet fields()}
    <div class="flex flex-col gap-12">
      <!-- The structure renders first and states its own emptiness inside itself: a room with
           nobody waiting to speak is the ordinary standing of a meeting. -->
      <ul class="flex flex-col gap-8">
        {#each hands as hand (hand.participantId)}
          <li class="flex items-center gap-8">
            <Avatar.Root>
              <Avatar.Fallback>{participantInitials(hand.name)}</Avatar.Fallback>
            </Avatar.Root>
            <span class="min-w-0 flex-1 truncate text-sm" title={hand.name}>{hand.name}</span>
            <!-- Each control names the person it is about, because a panel of five rows otherwise
                 offers a reader five controls all called Lower. -->
            <Button
              variant="ghost"
              size="sm"
              aria-label="Lower {hand.name}'s hand"
              onclick={() => onLowerHand(hand.participantId)}
            >
              Lower
            </Button>
            {#if hand.muted}
              <Button
                variant="secondary"
                size="sm"
                aria-label="Ask {hand.name} to unmute"
                onclick={() => onAskToUnmute(hand.participantId)}
              >
                <MicOff class="size-16" aria-hidden="true" />
                Ask to Unmute
              </Button>
            {/if}
          </li>
        {:else}
          <li class="text-sm text-text-muted">Nobody has their hand up.</li>
        {/each}
      </ul>

      {#if hands.length > 1}
        <!-- Offered only past one hand: with a single row it would be a second control doing what
             the row already does. It sits in the row's own order, so the answer a host reaches for
             is in the place they have been reaching for it on every line above. -->
        <div class="flex items-center justify-end gap-8">
          <Button variant="ghost" onclick={onLowerAll}>
            <Hand class="size-16" aria-hidden="true" />
            Lower All Hands
          </Button>
        </div>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
