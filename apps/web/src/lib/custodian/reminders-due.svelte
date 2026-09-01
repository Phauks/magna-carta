<script lang="ts">
  /*
   * What is due: a review whose date has passed, and a check-out past its due-back date.
   *
   * ONE READ, BECAUSE THERE IS ONE DEFINITION. The register decides both in the same place — a
   * reminder is a query, not a scheduler — and this surface asks that question rather than
   * assembling its own from two lists. Two definitions of "due" would eventually disagree, and the
   * one people acted on would be whichever they saw last.
   *
   * A REVIEW DATE IS NOT A RETENTION CLOCK, and the line under the table says so, because the
   * mistake it prevents is the expensive one. Nothing expires when a review date passes. The only
   * consequence is that the packet appears on this list, and a firm looks at it again. The register
   * ships no retention periods at all — what a firm must keep, and for how long, is the most
   * jurisdiction-bound fact in this subsystem, and a default here would be the platform holding an
   * opinion about when to destroy a client's irreplaceable property.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import { listCustodyReminders, type CustodyReminder } from "./custody-api.ts";
  import { overdueBucketLabel } from "./custody-vocabulary.ts";

  let { onOpenPacket }: { onOpenPacket: (packetId: string) => void } = $props();

  let reminders = $state<readonly CustodyReminder[] | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let asked = false;

  $effect(() => {
    if (asked) return;
    asked = true;
    void (async () => {
      const outcome = await listCustodyReminders(fetch);
      if (outcome.kind === "ok") {
        reminders = outcome.value.data;
        return;
      }
      reminders = [];
      failure = stated(outcome.failure, "What is due could not be read.");
    })();
  });

  /** What each reason reads as. The two words are the read's own; only the rendering is decided here. */
  function reasonLabel(reason: CustodyReminder["reason"]): string {
    return reason === "review-due" ? "Review due" : "Check-out overdue";
  }
</script>

<div class="flex flex-col gap-16">
  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      title="What Is Due Could Not Be Read"
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
    />
  {:else if reminders === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Reading what is due">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if reminders.length === 0}
    <EmptyState title="Nothing Is Due">
      No packet is past a review date and nothing is out past when somebody said it would be back.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">Reviews due and check-outs overdue</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Custody Number</DataTable.Head>
          <DataTable.Head>Why</DataTable.Head>
          <DataTable.Head>Due</DataTable.Head>
          <DataTable.Head>How long</DataTable.Head>
          <DataTable.Head>Scope</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each reminders as reminder (`${reminder.reason}-${reminder.packetId}-${reminder.itemId ?? ""}`)}
          <DataTable.Row>
            <DataTable.Cell>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => onOpenPacket(reminder.packetId)}
              >
                <span class="tabular-nums">{reminder.custodyNumber}</span>
              </Button>
            </DataTable.Cell>
            <DataTable.Cell>{reasonLabel(reminder.reason)}</DataTable.Cell>
            <DataTable.Cell><span class="tabular-nums">{reminder.dueOn}</span></DataTable.Cell>
            <DataTable.Cell>
              <Badge variant={reminder.bucket === "over-90d" ? "danger" : "warning"}>
                {overdueBucketLabel(reminder.bucket)}
              </Badge>
            </DataTable.Cell>
            <DataTable.Cell>
              {reminder.itemId === null ? "The whole packet" : "One item"}
            </DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>

    <p class="text-xs text-text-muted">
      A review date is not a retention clock. Nothing expires when one passes: the only consequence
      is that the packet appears here and somebody looks at it again.
    </p>
  {/if}
</div>
