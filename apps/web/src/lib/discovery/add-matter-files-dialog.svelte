<script lang="ts">
  /*
   * Putting the matter's own files into a load.
   *
   * NO BYTES MOVE, and that is worth knowing before you press. The platform already holds these
   * documents with their hashes and their scan verdicts, so each review document is a POINTER at
   * the file version you pick. It follows that loading is a SNAPSHOT and not a subscription: a
   * later version of the same file does not change what is under review, and bringing one in means
   * another load.
   *
   * A FILE THAT IS NOT CLEAN IS REFUSED BY NAME RATHER THAN HIDDEN. A version the scanner is still
   * reading, or one it refused, cannot enter a corpus — but leaving it off the list would make a
   * reviewer believe the matter holds fewer documents than it does, and a silently missing document
   * is a hole in a corpus somebody is about to certify the contents of. So every file shows, and
   * the ones that cannot be picked say why.
   *
   * ONE TURN AT A TIME, ASKED AGAIN UNTIL IT IS DONE. The server resolves a selection in bounded
   * turns and reports how far it got; a large selection therefore takes several calls, and the
   * dialog runs them rather than sending one request that would either time out or need a
   * different contract. Each turn carries its own key, so a repeat is answered with the first
   * result instead of allocating a document twice.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import Button from "@magna-carta/design-system/button";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { listMatterFiles, type MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { runInternalSelection, type RecordCustodian } from "./discovery-api.ts";

  let {
    open = $bindable(false),
    loadId,
    matterId,
    recordCustodians,
    defaultRecordCustodianId = null,
    onLoaded,
  }: {
    open?: boolean;
    loadId: string;
    matterId: string;
    recordCustodians: readonly RecordCustodian[];
    defaultRecordCustodianId?: string | null;
    onLoaded: () => void;
  } = $props();

  let files = $state<readonly MatterFile[] | null>(null);
  let selected = $state<ReadonlySet<string>>(new Set());
  let recordCustodianId = $state<string | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let progress = $state<string | null>(null);

  /** Why a file cannot enter a corpus, or undefined when it can. */
  function refusalFor(file: MatterFile): string | undefined {
    if (file.status === "quarantined") return "Refused by the scanner";
    if (file.status === "pending") return "Still being scanned";
    if (file.currentVersionId === null) return "No committed version";
    if (file.scanVerdict !== "clean") return "Not scanned clean";
    return undefined;
  }

  const selectable = $derived((files ?? []).filter((file) => refusalFor(file) === undefined));

  const custodianItems = $derived(
    recordCustodians.map((custodian) => ({ value: custodian.id, label: custodian.displayName })),
  );

  const refusal = $derived.by((): string | undefined => {
    if (files === null) return "Reading the matter's files.";
    if (recordCustodianId === null) {
      return "Say whose records these are. Every review document carries a Custodian of Record.";
    }
    if (selected.size === 0) return "Pick at least one document.";
    return undefined;
  });

  async function readFiles(): Promise<void> {
    failure = null;
    const outcome = await listMatterFiles(fetch, matterId);
    if (outcome.kind === "ok") {
      files = outcome.value.data;
      return;
    }
    files = [];
    failure = stated(outcome.failure, "The matter's files could not be read.");
  }

  function reset(): void {
    files = null;
    selected = new Set();
    recordCustodianId = defaultRecordCustodianId ?? recordCustodians[0]?.id ?? null;
    failure = null;
    progress = null;
    void readFiles();
  }

  function toggle(fileId: string): void {
    const next = new Set(selected);
    if (next.has(fileId)) next.delete(fileId);
    else next.add(fileId);
    selected = next;
  }

  function selectEvery(): void {
    selected = new Set(selectable.map((file) => file.id));
  }

  function selectNone(): void {
    selected = new Set();
  }

  /*
   * How many turns to ask for before giving up.
   *
   * A bound rather than a while-true, because a server that reported no progress would otherwise
   * spin here forever. It is generous — each turn allocates a large batch — and reaching it is
   * reported as what it is: the load is part-filled, which is a real and recoverable state, not a
   * failure of the load.
   */
  const MAXIMUM_TURNS = 50;

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    if (recordCustodianId === null || selected.size === 0) return "refused";
    const fileIds = [...selected];
    for (let turn = 0; turn < MAXIMUM_TURNS; turn += 1) {
      const outcome = await runInternalSelection(
        fetch,
        loadId,
        { recordCustodianId, fileIds },
        crypto.randomUUID(),
      );
      if (outcome.kind !== "ok") {
        failure = stated(
          outcome.failure,
          "The documents could not be added to the load.",
          "Couldn't connect. Anything already added is still on the load, and trying again picks up where it stopped.",
        );
        return "refused";
      }
      progress = `${outcome.value.allocatedCount} of ${fileIds.length} added.`;
      if (outcome.value.complete) {
        onLoaded();
        return "committed";
      }
    }
    failure = stated(
      { problem: null, request: `POST /api/v1/loads/${loadId}/internal-selection`, failedAt: new Date() },
      "The load is partly filled because it didn't finish in time. Nothing is lost. Open it again to continue.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Add the Matter's Files"
  commitLabel="Add to Load"
  commitBusyLabel="Adding"
  commitRefusal={refusal}
  width="wide"
  unsavedChanges={selected.size > 0}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Documents Were Not Added"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
        onRetry={files === null || files.length === 0 ? () => void readFiles() : undefined}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy }: { busy: boolean })}
    <div class="flex flex-col gap-16">
      <!-- What picking a version actually does, said beside the picking rather than in the line that
           names the subject. Nothing is copied, so the load is a set of pointers. -->
      <p class="text-xs text-text-muted">
        Each document becomes a pointer at the version you pick. Nothing is copied, and a later
        version does not change what is under review.
      </p>

      <div class="flex flex-col gap-8">
        <Label id="add-files-custodian-label">Custodian of Record</Label>
        <Select.Root
          type="single"
          items={custodianItems}
          value={recordCustodianId ?? ""}
          onValueChange={(value) => (recordCustodianId = value === "" ? null : value)}
          allowDeselect={false}
          disabled={busy || custodianItems.length === 0}
        >
          <Select.Trigger aria-labelledby="add-files-custodian-label">
            <Select.Value placeholder={placeholderOf("Custodian of Record")} />
          </Select.Trigger>
          <Select.Content>
            {#each custodianItems as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
        <p class="text-text-muted text-sm">
          Whose records these are. Every document in a corpus carries one, and it is the first thing
          a review is narrowed by.
        </p>
      </div>

      {#if files !== null && files.length > 0}
        <div class="flex items-center gap-8">
          <Button variant="ghost" disabled={busy} onclick={selectEvery}>
            Select every eligible document
          </Button>
          <Button variant="ghost" disabled={busy || selected.size === 0} onclick={selectNone}>
            Clear
          </Button>
          <span class="text-text-muted ml-auto text-sm tabular-nums">
            {selected.size} of {selectable.length} selected
          </span>
        </div>

        <ul class="mc-scrollbar border-border flex max-h-96 flex-col gap-4 overflow-y-auto rounded border p-8">
          {#each files as file (file.id)}
            {@const refused = refusalFor(file)}
            <li class="flex items-center gap-8">
              <Checkbox
                id="add-files-{file.id}"
                disabled={busy || refused !== undefined}
                checked={selected.has(file.id)}
                onCheckedChange={() => toggle(file.id)}
              />
              <Label for="add-files-{file.id}" class="min-w-0 flex-1 truncate">{file.name}</Label>
              {#if refused !== undefined}
                <span class="text-text-muted shrink-0 text-sm">{refused}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {:else if files !== null}
        <p class="text-text-muted text-sm">
          This matter holds no files yet. Documents reach a review set from the matter's own file
          record, so there is nothing here to put in one.
        </p>
      {/if}

      {#if progress !== null}
        <p class="text-text-muted text-sm tabular-nums">{progress}</p>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
