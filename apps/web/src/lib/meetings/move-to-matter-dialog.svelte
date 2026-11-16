<script lang="ts">
  /*
   * Move a personal-room meeting onto a matter, during it or after it.
   *
   * A personal room opens on the owner's own calendar because, when it opens, nobody has said what
   * the conversation is about. Once they have, the meeting belongs on the matter: its event moves
   * there with everybody who was on it, the meeting keeps its address so nobody in the room is
   * disturbed, and from then on it can be recorded like any other matter meeting.
   *
   * THE MOVE IS ONE WAY. A meeting on a matter stays there; the server refuses a second move, and
   * the control is not offered once the meeting is on one.
   *
   * THE MATTERS ARE THE CALENDAR'S, read through `calendarContext` so the list is the one every
   * other calendar form offers rather than a second walk of the firm's matters.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import { calendarContext } from "$lib/calendar/calendar-context.svelte.ts";
  import { moveMeetingToMatter } from "./personal-room-api.ts";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { Failure } from "$lib/api/problem.ts";

  let {
    open = $bindable(false),
    meetingId,
    subject,
    onMoved,
  }: {
    open?: boolean;
    meetingId: string;
    /** Which meeting this is about, named once. */
    subject: RecordSubject;
    /** Told once the meeting is on the matter, so the screen reads the meeting again. */
    onMoved: () => void;
  } = $props();

  const context = calendarContext;
  $effect(() => {
    if (open) void context.load(fetch);
  });

  let matterId = $state<string | null>(null);
  let failure = $state<Failure | null>(null);

  async function move(): Promise<ActionOutcome> {
    if (matterId === null) return "refused";
    failure = null;
    const outcome = await moveMeetingToMatter(meetingId, matterId);
    if (outcome.kind !== "ok") {
      failure = outcome.failure;
      return "refused";
    }
    onMoved();
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Move to a Matter"
  subtitle={subject}
  commitLabel="Move to the Matter"
  commitBusyLabel="Moving"
  commitRefusal={matterId === null ? "Choose the matter first." : undefined}
  unsavedChanges={matterId !== null}
  onCommit={move}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        {failure}
        subject="This meeting"
        title="Meeting Not Moved"
        fallback="The meeting wasn't moved."
        whenSilent="Couldn't connect. The meeting wasn't moved. Try again."
      />
    {/if}
  {/snippet}
  {#snippet fields()}
    <p class="text-sm">
      The meeting's calendar entry moves to the matter with everyone on it. The meeting keeps its address, so nobody in the room is interrupted. This can't be undone.
    </p>
    <div class="flex flex-col gap-8">
      <Label for="move-to-matter-matter">Matter</Label>
      <MatterPicker
        inputId="move-to-matter-matter"
        matters={context.matters}
        capped={context.mattersCapped}
        reading={context.mattersReading}
        value={matterId}
        offerNoMatter={false}
        onpick={(picked) => (matterId = picked)}
      />
    </div>
  {/snippet}
</ActionDialog>
