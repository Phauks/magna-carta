<script lang="ts">
  /*
   * Who is at the door, and the two answers a host may give each of them.
   *
   * IT IS A READING PANEL. A host opens it to find out whether the person they are waiting for has
   * arrived at least as often as to let somebody in, so its action bar carries only the way out and
   * each decision is offered in place, on the row it is about — the house shape for exactly this
   * case, and the one the hosts panel beside it already keeps.
   *
   * IT IS THE HOST'S ALONE. Who is at the door is a list of people a host has not yet decided about,
   * and the room sends it to the sockets holding a grant and to nobody else — so this panel is
   * opened from a control that is absent for everybody who is not running the meeting, and it would
   * have nothing to draw for them either.
   *
   * ADMIT ALL SENDS THE IDENTIFIERS ON SCREEN, and that is the whole reason there is no server-side
   * "everybody". A server-side "all" would admit whoever arrived in the millisecond after the host
   * looked at the list, which in a lobby that exists because somebody might arrive who should not is
   * precisely the person the host did not decide about. Deny all is the same list under the same
   * rule, and both are answered the same way: one outcome per identifier, because a batch can
   * half-land and rows that did not move look exactly like rows nobody pressed.
   *
   * ONLY ONE OF THE TWO IS ASKED ABOUT FIRST. Letting somebody in who should not have come in is
   * undone by removing them; turning everybody away bars every one of them from this meeting while
   * it runs, and the people it happens to are standing outside with nothing left to press. So deny
   * all goes behind the one panel the product asks acts in, and admit all stays immediate.
   *
   * THE ROW STATES WHEN SOMEBODY ARRIVED, NOT HOW LONG THEY HAVE BEEN THERE. A duration counting up
   * beside a control moves the control under the pointer every minute, which is the one thing a row
   * carrying Admit and Deny must never do.
   */
  import DoorClosed from "@lucide/svelte/icons/door-closed";
  import DoorOpen from "@lucide/svelte/icons/door-open";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import { formatTimeOfDay } from "@magna-carta/design-system/formatters";
  import { participantInitials } from "./screen/meeting-tiles.ts";
  import type { WaitingParticipant } from "./client/meeting-client.svelte.ts";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { Snippet } from "svelte";

  /** What somebody at the door with no name on their stay is drawn under. */
  const UNNAMED_ARRIVAL = "Arriving";

  let {
    open = $bindable(false),
    subject,
    waiting,
    onAdmit,
    onDeny,
    writeFailure,
  }: {
    open?: boolean;
    /** Which meeting this is about, named once. */
    subject: RecordSubject;
    /**
     * Everybody at the door, as the room last stated it. It is the LIVE list rather than a read:
     * the room re-sends it whole to every host as the queue moves, so a panel left open is current
     * without asking, and a second read would only ever be a staler answer to the same question.
     */
    waiting: readonly WaitingParticipant[];
    /** Let these stays in. Addressed by the stay, like everything else in this room. */
    onAdmit: (participantIds: readonly string[]) => void;
    /** Turn these stays away. They are barred from this meeting while it runs. */
    onDeny: (participantIds: readonly string[]) => void;
    /** A refused write, in the app's own words, rendered in the shell's reserved band. */
    writeFailure?: Snippet;
  } = $props();

  /** What the panel is showing, which is exactly what either batch sends. */
  const shown = $derived(waiting.map((person) => person.participantId));

  /** Whether the question about turning everybody away is standing. */
  let denyingAll = $state(false);

  /**
   * Turn away exactly the people the panel was showing when the question was asked.
   *
   * The list is read at the COMMIT rather than held from the press, so somebody who was admitted
   * while the question stood is not denied on their way in. It is the same list Admit all sends and
   * the same route, so what the batch did not do is stated in the one place both report it.
   */
  function denyEveryone(): Promise<ActionOutcome> {
    onDeny(shown);
    return Promise.resolve("committed");
  }
</script>

<ActionDialog bind:open kind="reading" heading="Waiting Room" subtitle={subject} width="narrow">
  {#snippet notice()}
    {@render writeFailure?.()}
  {/snippet}

  {#snippet fields()}
    <div class="flex flex-col gap-12">
      <!-- The structure renders first and states its own emptiness inside itself: an empty door is
           the ordinary standing of a meeting nobody is late for. -->
      <ul class="flex flex-col gap-8">
        {#each waiting as person (person.participantId)}
          {@const name = person.displayName === "" ? UNNAMED_ARRIVAL : person.displayName}
          <li class="flex items-center gap-8">
            <Avatar.Root>
              <Avatar.Fallback>{participantInitials(name)}</Avatar.Fallback>
            </Avatar.Root>
            <span class="min-w-0 flex-1 truncate text-sm" title={name}>{name}</span>
            <span class="text-xs text-text-muted">{formatTimeOfDay(person.waitingFrom)}</span>
            <!-- Each control names the person it is about, because a panel of five rows otherwise
                 offers a reader five controls all called Admit. -->
            <Button
              variant="ghost"
              size="sm"
              aria-label="Deny {name}"
              onclick={() => onDeny([person.participantId])}
            >
              Deny
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Admit {name}"
              onclick={() => onAdmit([person.participantId])}
            >
              Admit
            </Button>
          </li>
        {:else}
          <li class="text-sm text-text-muted">Nobody is waiting.</li>
        {/each}
      </ul>

      {#if shown.length > 1}
        <!-- The two steps offered in place, beside the fact they change. Offered only past one
             person: with a single row they would be two controls doing what the row already does.
             They sit in the row's own order, so the answer a host reaches for is in the place they
             have been reaching for it on every line above. -->
        <div class="flex items-center justify-end gap-8">
          <Button variant="ghost" onclick={() => (denyingAll = true)}>
            <DoorClosed class="size-16" aria-hidden="true" />
            Deny All
          </Button>
          <Button variant="secondary" onclick={() => onAdmit(shown)}>
            <DoorOpen class="size-16" aria-hidden="true" />
            Admit All
          </Button>
        </div>
      {/if}
    </div>
  {/snippet}
</ActionDialog>

<!-- The question, over the reading panel it was asked from: everybody outside is barred from this
     meeting at once, and each of them is standing at a door with nothing left to press. -->
<ActionDialog
  bind:open={denyingAll}
  kind="destructive"
  heading="Deny Everyone Waiting"
  subtitle={subject}
  commitLabel="Deny Everyone"
  commitBusyLabel="Denying"
  unsavedChanges={false}
  onCommit={denyEveryone}
>
  {#snippet fields()}
    <p class="text-sm">
      Everybody at the door is turned away, and each of them is barred from this meeting while it
      runs. They can be let in again only from a new meeting on this event.
    </p>
  {/snippet}
</ActionDialog>
