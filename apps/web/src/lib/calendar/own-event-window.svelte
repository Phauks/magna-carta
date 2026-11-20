<script lang="ts">
  /*
   * The window one of the reader's own Outlook or Google events opens in.
   *
   * It shows the event as their own calendar holds it and asks the only two things the firm's
   * calendar does not already know: which matter it belongs on, and what kind of event it is. Add
   * to Matter does it in that one step (owner, 2026-11-20: a second form after this window made
   * no sense). Anything else about the event is changed afterwards, in the event's own window.
   *
   * The decisions are own-event-on-matter.ts's: what is still unanswered, when the event reads as
   * being, and what the save sends. This file renders them.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import { createMatterEvent } from "./calendar-api.ts";
  import type { calendarContext } from "./calendar-context.svelte.ts";
  import { UNTITLED_OWN_EVENT_LABEL } from "./calendar-entries.ts";
  import { calendarManageRefusal } from "./calendar-permission.ts";
  import EventTypeSelect from "./event-type-select.svelte";
  import type { OwnAccountEvent } from "./own-account-events.ts";
  import {
    ownEventOnMatterRequest,
    ownEventShortfalls,
    ownEventSource,
    ownEventWhen,
    type OwnEventOnMatterDraft,
  } from "./own-event-on-matter.ts";
  import { shortfallSentences } from "./shortfall.ts";

  let {
    open = $bindable(false),
    event,
    context,
    onAdded,
  }: {
    open?: boolean;
    /** The reader's own event the window is on. Null draws nothing; the host opens it on one. */
    event: OwnAccountEvent | null;
    context: typeof calendarContext;
    /** The event is on a matter now, so the grid reads again. */
    onAdded: () => void;
  } = $props();

  const idPrefix = $props.id();

  let draft = $state<OwnEventOnMatterDraft>({ matterId: null, eventTypeId: null });
  let failure = $state<StatedFailure | null>(null);
  let attemptKey: string | null = null;

  function reset(): void {
    draft = { matterId: null, eventTypeId: null };
    failure = null;
    attemptKey = null;
  }

  const typeItems = $derived(
    context.eventTypes
      .filter((eventType) => eventType.active)
      .map((eventType) => ({ value: eventType.id, label: eventType.name })),
  );

  const title = $derived(
    event === null || event.title.trim() === "" ? UNTITLED_OWN_EVENT_LABEL : event.title,
  );
  const when = $derived(event === null ? "" : ownEventWhen(event, context.readerTimeZone || "UTC"));

  const refusal = $derived(
    calendarManageRefusal("Adding an event to a matter", context) ??
      shortfallSentences(ownEventShortfalls(draft))[0],
  );

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    const request =
      event === null
        ? null
        : ownEventOnMatterRequest(event, draft, {
            timeZone: context.readerTimeZone,
            memberUserId: context.memberId,
          });
    if (request === null || draft.matterId === null) return "refused";
    attemptKey ??= crypto.randomUUID();
    const outcome = await createMatterEvent(fetch, draft.matterId, request, attemptKey);
    if (outcome.kind === "ok") {
      attemptKey = null;
      onAdded();
      return "committed";
    }
    // A refusal is an answer, so the attempt is over; silence is not, so the key is kept and the
    // same write is repeated rather than a second one made.
    if (outcome.kind === "problem") attemptKey = null;
    failure = stated(
      outcome.failure,
      "The event could not be added to the matter.",
      "Couldn't connect. The event wasn't added. Try again.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading={title}
  commitLabel="Add to Matter"
  commitBusyLabel="Adding to Matter"
  commitRefusal={refusal}
  unsavedChanges={draft.matterId !== null || draft.eventTypeId !== null}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Event Was Not Added"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    {#if event !== null}
      <div class="flex flex-col gap-16">
        <DefinitionList.Root>
          <DefinitionList.Row term="When">{when}</DefinitionList.Row>
          {#if event.location !== null && event.location.trim() !== ""}
            <DefinitionList.Row term="Where">{event.location}</DefinitionList.Row>
          {/if}
          <DefinitionList.Row term="From">{ownEventSource(event)}</DefinitionList.Row>
        </DefinitionList.Root>

        <div class="grid gap-16 sm:grid-cols-2">
          <div class="flex flex-col gap-8">
            <Label necessity="required" for="{idPrefix}-matter">Matter</Label>
            <MatterPicker
              inputId="{idPrefix}-matter"
              matters={context.matters}
              capped={context.mattersCapped}
              reading={context.mattersReading}
              value={draft.matterId}
              disabled={busy}
              onpick={(picked) => (draft.matterId = picked)}
            />
          </div>
          <EventTypeSelect
            id="{idPrefix}-type"
            items={typeItems}
            value={draft.eventTypeId}
            disabled={busy}
            onchange={(value) => (draft.eventTypeId = value)}
          />
        </div>

        <p class="text-sm text-text-muted">
          Everyone who can see the matter will see this event. It stays in your own calendar as the same event, so you will not see it twice.
        </p>
      </div>
    {/if}
  {/snippet}
</ActionDialog>
