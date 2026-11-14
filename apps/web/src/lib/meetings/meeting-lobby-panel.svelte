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
   * DENY ALL IS ANSWERED FROM THE LIST THE QUESTION WAS ASKED ABOUT, not from the live one. The
 * question stands over an open door: somebody can arrive between the press and the commit, and a
 * live list read at the commit would bar a person the host never saw — which is exactly the harm
 * the absence of a server-side "everybody" exists to prevent, arriving by the other door. The
 * snapshot is taken when the question opens and nothing widens it afterwards; somebody admitted
 * while it stood is simply no longer waiting, which the batch's own per-identifier answer says.
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
   * A GUEST'S ROW CARRIES TWO NAMES AND A MARK. The name they typed at the door, and beneath it the
   * Directory name the link was minted for — the pair a forwarded link cannot hide, shown at the one
   * moment it is still cheap to act on. Neither replaces the other, and the mark sits in a column of
   * its own rather than inside the name, so a long name truncates without taking the mark with it.
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
  import Badge from "@magna-carta/design-system/badge";
  import { participantInitials } from "./screen/meeting-tiles.ts";
  import { GUEST_LABEL, invitedAsLabel } from "./screen/meeting-host-labels.ts";
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
  /** Exactly who was at the door when the question was asked. Empty while it is not standing. */
  let denyingTheseIds = $state<readonly string[]>([]);

  /** Ask the question, over the people the host is looking at as they ask it. */
  function askToDenyEveryone(): void {
    denyingTheseIds = shown;
    denyingAll = true;
  }

  /**
   * Turn away exactly the people the panel was showing when the question was asked.
   *
   * The snapshot is what is sent, never the live list: somebody who arrived while the question
   * stood is a person the host has not decided about, and barring them would be the server-side
   * "everybody" this panel refuses to have. Somebody ADMITTED while it stood is simply no longer
   * waiting, and the batch's own per-identifier answer says so. It is the same route Admit all
   * uses, so what the batch did not do is stated in the one place both report it.
   */
  function denyEveryone(): Promise<ActionOutcome> {
    onDeny(denyingTheseIds);
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
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm" title={name}>{name}</span>
              {#if person.kind === "guest" && person.invitedName !== null}
                {@const invited = invitedAsLabel(person.invitedName)}
                <span class="truncate text-xs text-text-muted" title={invited}>{invited}</span>
              {/if}
            </span>
            {#if person.kind === "guest"}
              <Badge class="shrink-0" variant="info" caps>{GUEST_LABEL}</Badge>
            {/if}
            <span class="shrink-0 text-xs text-text-muted">{formatTimeOfDay(person.waitingFrom)}</span>
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
          <Button variant="ghost" onclick={askToDenyEveryone}>
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
      Everyone waiting at the door is turned away and can't come back while this meeting runs. They can only be let into a meeting on a new calendar entry.
    </p>
  {/snippet}
</ActionDialog>
