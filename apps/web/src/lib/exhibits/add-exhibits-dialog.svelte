<script lang="ts">
  /*
   * Adding this matter's files to a draft set by hand. Only files with a clean version can be
   * exhibits, and a file already in the set is not offered again. A file that is already an exhibit
   * on the matter (in another set) is reused, so its title and reference stay one record; any other
   * file becomes a new exhibit titled from its name. The chosen files join at the end, in the order
   * they are listed here.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Label from "@magna-carta/design-system/label";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { titleFromFileName } from "@magna-carta/exhibits/file-title";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { listMatterFiles, type MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import {
    addExhibitSetMembers,
    createExhibit,
    type ExhibitSetDetail,
    type MatterExhibit,
  } from "./exhibits-api.ts";

  let {
    open = $bindable(false),
    set,
    register,
    onAdded,
  }: {
    open?: boolean;
    set: ExhibitSetDetail;
    /** The matter's exhibits, so a file that already is one is reused rather than made twice. */
    register: readonly MatterExhibit[];
    onAdded: () => void;
  } = $props();

  let files = $state<readonly MatterFile[] | null>(null);
  let chosen = $state<readonly string[]>([]);
  let term = $state("");
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    files = null;
    chosen = [];
    term = "";
    failure = null;
    void listMatterFiles(fetch, set.matterId).then((outcome) => {
      files = outcome.kind === "ok" ? outcome.value.data : [];
    });
  }

  const inSet = $derived(new Set(set.members.map((member) => member.fileId)));
  const offered = $derived(
    (files ?? [])
      .filter((file) => file.currentVersionId !== null && !inSet.has(file.id))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
  const shown = $derived.by(() => {
    const needle = term.trim().toLowerCase();
    return needle === ""
      ? offered
      : offered.filter((file) => file.name.toLowerCase().includes(needle));
  });

  function toggle(fileId: string, on: boolean): void {
    chosen = on ? [...chosen, fileId] : chosen.filter((candidate) => candidate !== fileId);
  }

  const refusal = $derived(chosen.length === 0 ? "Choose at least one file." : undefined);

  /*
   * One exhibit per chosen file, in the listed order, then one add. A file that fails to become an
   * exhibit stops the run before anything joins the set, so the set never gains half a choice.
   */
  async function commit(): Promise<ActionOutcome> {
    failure = null;
    const exhibitIds: string[] = [];
    for (const file of offered) {
      if (!chosen.includes(file.id)) continue;
      const existing = register.find(
        (exhibit) => exhibit.fileId === file.id && exhibit.archivedAt === null,
      );
      if (existing !== undefined) {
        exhibitIds.push(existing.id);
        continue;
      }
      const created = await createExhibit(fetch, set.matterId, file.id, titleFromFileName(file.name));
      if (created.kind !== "ok") {
        failure = stated(
          created.failure,
          `${file.name} could not be made an exhibit, so nothing was added.`,
          "Couldn't connect, so nothing was added.",
        );
        return "refused";
      }
      exhibitIds.push(created.value.id);
    }
    const outcome = await addExhibitSetMembers(fetch, set.matterId, set.id, exhibitIds);
    if (outcome.kind === "ok") {
      onAdded();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The exhibits were not added to the set.",
      "Couldn't connect, so nothing was added.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Add Exhibits"
  commitLabel={chosen.length > 1 ? `Add ${String(chosen.length)} Exhibits` : "Add Exhibit"}
  commitBusyLabel="Adding"
  commitRefusal={refusal}
  unsavedChanges={chosen.length > 0}
  onOpen={reset}
  onCommit={commit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Added"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <ScreenSearch
        bind:value={term}
        label="Find a file"
        searchOn="keystroke"
        disabled={busy || files === null}
        fieldClass="w-full"
      />
      {#if files === null}
        <p class="text-sm text-text-muted" aria-live="polite">Reading this matter's files</p>
      {:else if offered.length === 0}
        <EmptyState title="Every file on this matter is already in the set." />
      {:else if shown.length === 0}
        <EmptyState title="No files match that search." />
      {:else}
        <ul class="mc-scrollbar flex max-h-96 flex-col overflow-y-auto">
          {#each shown as file (file.id)}
            {@const id = `exhibit-file-${file.id}`}
            <li class="flex items-center gap-8 border-b border-border-subtle py-8">
              <Checkbox
                {id}
                disabled={busy}
                checked={chosen.includes(file.id)}
                onCheckedChange={(on) => toggle(file.id, on)}
              />
              <Label for={id} class="min-w-0 flex-1 truncate">{file.name}</Label>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
