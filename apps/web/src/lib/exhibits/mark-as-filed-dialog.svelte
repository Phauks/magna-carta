<script lang="ts">
  /*
   * Recording that a set went out. The platform does not file anything: this is the member saying
   * the set was filed, served, exchanged or lodged, and on which day. It cannot be undone, and the
   * dialog says so, because every label, title and version is written down as it is now and never
   * changes afterwards. A set that went out wrong is replaced by an amended set.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import Label from "@magna-carta/design-system/label";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { zonedReading } from "@magna-carta/civil-time/time-zone";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { civilDateTextOrEmpty, civilDateValue, viewerTimeZone } from "$lib/dates";
  import { issueExhibitSet, type ExhibitDisposition, type ExhibitSetDetail } from "./exhibits-api.ts";
  import { DISPOSITION_WORDS } from "./exhibit-words.ts";

  let {
    open = $bindable(false),
    set,
    onIssued,
  }: {
    open?: boolean;
    set: ExhibitSetDetail;
    onIssued: () => void;
  } = $props();

  const ITEMS = (Object.keys(DISPOSITION_WORDS) as ExhibitDisposition[]).map((value) => ({
    value,
    label: DISPOSITION_WORDS[value],
  }));

  let disposition = $state<ExhibitDisposition>("filed");
  let issuedOn = $state("");
  let failure = $state<StatedFailure | null>(null);

  function today(): string {
    return zonedReading(Date.now(), viewerTimeZone()).civilDate;
  }

  function reset(): void {
    disposition = "filed";
    issuedOn = today();
    failure = null;
  }

  const activeCount = $derived(set.members.filter((member) => member.status === "active").length);
  const refusal = $derived.by((): string | undefined => {
    if (activeCount === 0) return "Add at least one exhibit first.";
    if (issuedOn === "") return "Choose the day it went out.";
    return undefined;
  });

  async function commit(): Promise<ActionOutcome> {
    failure = null;
    const outcome = await issueExhibitSet(fetch, set.matterId, set.id, disposition, issuedOn);
    if (outcome.kind === "ok") {
      onIssued();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The set was not marked as filed.",
      "Couldn't connect, so the set is still a draft.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Record That the Set Went Out"
  commitLabel="Mark as Filed"
  commitBusyLabel="Marking"
  commitRefusal={refusal}
  width="narrow"
  unsavedChanges={false}
  onOpen={reset}
  onCommit={commit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Changed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <p class="text-sm">
        {set.name}, {activeCount}
        {activeCount === 1 ? "exhibit" : "exhibits"}.
      </p>
      <div class="flex flex-col gap-8">
        <Label id="exhibit-disposition-label">How It Went Out</Label>
        <Select.Root
          type="single"
          items={ITEMS}
          disabled={busy}
          allowDeselect={false}
          bind:value={
            () => disposition,
            (picked) => (disposition = (picked as ExhibitDisposition) || "filed")
          }
        >
          <Select.Trigger aria-labelledby="exhibit-disposition-label">
            <Select.Value placeholder={placeholderOf("How")} />
          </Select.Trigger>
          <Select.Content>
            {#each ITEMS as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="flex flex-col gap-8">
        <DatePicker
          label="Date"
          value={civilDateValue(issuedOn)}
          onValueChange={(next) => (issuedOn = civilDateTextOrEmpty(next))}
          disabled={busy}
        />
      </div>
      <Alert.Root variant="warning">
        <Alert.Title>This Can't Be Undone</Alert.Title>
        <Alert.Description>
          The labels, titles and file versions are kept as they are now. To change the set later,
          start an amended set.
        </Alert.Description>
      </Alert.Root>
    </div>
  {/snippet}
</ActionDialog>
