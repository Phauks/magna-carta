<script lang="ts">
  /*
   * The re-checks a matter is owed: every change to the firm's own records since the last check
   * that could have changed its answer, oldest first, and the firm's scheduled re-screening.
   *
   * THE RAIL IS COMPUTED, NOT STORED. What is owed is derived at read time from what changed since,
   * so nothing is written onto the matter and nothing has to be swept.
   *
   * A BACKSTOP SWITCHED OFF IS STATED. A firm that turned its scheduled re-screening off made a
   * choice about its own procedure, and the section says so rather than leaving it invisible.
   */
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import EventRail, { type EventRailEvent } from "@magna-carta/design-system/event-rail";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import type { Snippet } from "svelte";
  import type { MatterConflictsPosture } from "./conflicts-api.ts";
  import { causeTopicLabel } from "./conflicts-vocabulary.ts";

  let {
    posture,
    action,
  }: {
    posture: MatterConflictsPosture;
    /** What the screen offers here: asking for a re-check now, most of the time. */
    action?: Snippet;
  } = $props();

  const events = $derived.by((): EventRailEvent[] =>
    posture.pendingRecheck.map((pending, index) => ({
      id: `${pending.causeTopic}-${pending.causeReference}-${String(index)}`,
      action: causeTopicLabel(pending.causeTopic),
      at: pending.causeOccurredAt,
      source: "The firm's own records",
      detail: `Noticed ${formatInstant(pending.requestedAt)}. Reference ${pending.causeReference}.`,
    })),
  );
</script>

<div class="flex flex-col gap-12 text-sm">
  {#if action}<div class="flex flex-wrap gap-8">{@render action()}</div>{/if}
  <EventRail
    {events}
    label="Re-checks this matter is owed"
    emptyMessage="Nothing has changed in the firm's records since the last check that would change its answer."
  />
  <DefinitionList.Root>
    <DefinitionList.Row term="Scheduled Re-screening">
      {posture.periodicRescan.enabled
        ? `Every ${String(posture.periodicRescan.intervalDays)} days`
        : "Switched off by the firm"}
    </DefinitionList.Row>
    <DefinitionList.Row term="Last Scheduled Pass">
      {posture.periodicRescan.lastRunAt === null
        ? "No scheduled pass has run"
        : formatInstant(posture.periodicRescan.lastRunAt)}
    </DefinitionList.Row>
  </DefinitionList.Root>
</div>
