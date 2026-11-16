<script lang="ts">
  /*
   * Metadata: what a document or picture carries that nobody typed on purpose, and a clean copy
   * without the parts the reader ticks.
   *
   * One table per thing the scrub can remove, each with its own box, all ticked to start: the usual
   * reason to be here is to send the file, and the safe default is to send less. The original is
   * never changed; the clean copy is saved, or put on the bench beside it, where every other tab
   * can check it.
   *
   * The reader (`@magna-carta/metadata`) is plain TypeScript and runs in this browser, so the values
   * it reads (who wrote a comment, where a picture was taken) never leave this machine. Each table
   * lists them: a property and what it says, or who changed what and when.
   */
  import Eraser from "@lucide/svelte/icons/eraser";
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import type { MetadataFailure, MetadataReport } from "@magna-carta/metadata";
  import { saveToTarget } from "$lib/export/save-target.ts";
  import Absence from "../parts/absence.svelte";
  import {
    cleanCopyName,
    groupsOf,
    leftBehind,
    optionsFrom,
    type FindingGroup,
    type TableCell,
    type ScrubSwitch,
  } from "../metadata-reading.ts";
  import type { CapabilityPanelProps } from "../capability.ts";

  let { file, onAddFiles }: CapabilityPanelProps = $props();

  type Reading =
    | { readonly kind: "reading" }
    | { readonly kind: "read"; readonly report: MetadataReport; readonly bytes: Uint8Array }
    | { readonly kind: "unsupported" }
    | { readonly kind: "failed"; readonly reason: string };

  type CleanCopy = {
    readonly copy: File;
    readonly remaining: number;
  };

  const FAILURE_REASONS: Readonly<Record<Exclude<MetadataFailure, "unsupported-format">, string>> = {
    "too-large": "This file is larger than the reader will open in a browser.",
    corrupt: "This file could not be read. It may be damaged; the Repair tab can look at it.",
    "decompression-bomb": "This file expands to far more than its size, so it was not opened.",
  };

  let reading = $state<Reading>({ kind: "reading" });
  let ticked = $state<Set<ScrubSwitch>>(new Set());
  let cleaning = $state(false);
  let cleanFailure = $state<string | null>(null);
  let clean = $state<CleanCopy | null>(null);

  const port = import("@magna-carta/metadata").then(({ createMetadataPort }) => createMetadataPort());

  $effect(() => {
    const target = file;
    reading = { kind: "reading" };
    clean = null;
    cleanFailure = null;
    let current = true;
    void (async () => {
      try {
        const bytes = await target.readBytes();
        const outcome = await (await port).inspect({ bytes, filename: target.name });
        if (!current) return;
        if (outcome.ok) {
          reading = { kind: "read", report: outcome.report, bytes };
          ticked = new Set(groupsOf(outcome.report).map((group) => group.switch));
        } else if (outcome.reason === "unsupported-format") {
          reading = { kind: "unsupported" };
        } else {
          reading = { kind: "failed", reason: FAILURE_REASONS[outcome.reason] };
        }
      } catch {
        if (current) reading = { kind: "failed", reason: "The file could not be read from the workbench." };
      }
    })();
    return () => {
      current = false;
    };
  });

  const groups = $derived(reading.kind === "read" ? groupsOf(reading.report) : []);

  // The name column and the moment column take a fixed share; the value takes the rest, because the
  // value is what wraps longest. Where hidden text sits is one word, so it takes less.
  function columnWidth(group: FindingGroup, index: number): string | undefined {
    const count = group.columns.length;
    if (count === 2 && index === 0) return group.switch === "hiddenContent" ? "w-1/4" : "w-2/5";
    if (count === 3 && (index === 0 || index === 2)) return "w-1/4";
    return undefined;
  }

  // A cell wraps anywhere, so a long path never widens its column. Under the narrow breakpoint the
  // cells of a row stack: the first reads as a small label over the rest, the hairline is drawn
  // once under the row, and an empty cell collapses to nothing.
  function cellClass(cell: TableCell, index: number): string {
    const classes = ["align-top whitespace-normal wrap-anywhere @max-sm:block @max-sm:not-last:border-b-0"];
    if (cell.text === "" && cell.note === undefined) classes.push("@max-sm:py-0");
    else if (index === 0) classes.push("@max-sm:pb-0 @max-sm:text-xs @max-sm:text-text-muted");
    else classes.push("@max-sm:pt-4");
    if (cell.muted === true) classes.push("text-text-muted");
    return classes.join(" ");
  }

  const highRisk = $derived(
    groups.filter((group) => group.findings.some((finding) => finding.risk === "high")).map((group) => group.title),
  );

  function setTicked(key: ScrubSwitch, on: boolean): void {
    const next = new Set(ticked);
    if (on) next.add(key);
    else next.delete(key);
    ticked = next;
    clean = null;
  }

  async function makeCleanCopy(): Promise<File | null> {
    if (reading.kind !== "read") return null;
    if (clean !== null) return clean.copy;
    cleaning = true;
    cleanFailure = null;
    try {
      const outcome = await (await port).scrub({ bytes: reading.bytes, filename: file.name }, optionsFrom(ticked));
      if (!outcome.ok) {
        cleanFailure = "A clean copy could not be made from this file.";
        return null;
      }
      const copy = new File([new Uint8Array(outcome.bytes)], cleanCopyName(file.name), { type: outcome.mediaType });
      clean = { copy, remaining: leftBehind(outcome.report, ticked).length };
      return copy;
    } catch {
      cleanFailure = "A clean copy could not be made from this file.";
      return null;
    } finally {
      cleaning = false;
    }
  }

  async function saveCleanCopy(): Promise<void> {
    const copy = await makeCleanCopy();
    if (copy !== null) await saveToTarget(copy, copy.name, copy.type);
  }

  async function putCleanCopyOnBench(): Promise<void> {
    if (onAddFiles === undefined) return;
    const copy = await makeCleanCopy();
    if (copy !== null) onAddFiles([copy]);
  }
</script>

{#if reading.kind === "reading"}
  <Absence kind="not-run" reason="Reading the file." />
{:else if reading.kind === "unsupported"}
  <Absence kind="not-applicable" reason="Metadata is read from Word documents, JPEG and PNG pictures so far." />
{:else if reading.kind === "failed"}
  <Absence kind="failed" reason={reading.reason} />
{:else if groups.length === 0}
  <Absence kind="not-applicable" reason="This file carries no hidden metadata the reader looks for." />
{:else}
  <div class="@container flex flex-col gap-24">
    <div class="flex flex-wrap items-center gap-8">
      <Badge variant="warning">{groups.length === 1 ? "1 Kind Found" : `${groups.length} Kinds Found`}</Badge>
      {#each highRisk as title (title)}
        <Badge variant="danger">{title}</Badge>
      {/each}
    </div>

    <div class="grid min-w-0 items-start gap-16 @5xl:grid-cols-2">
      {#each groups as group (group.switch)}
        {@const boxId = `metadata-${group.switch}`}
        <!-- Fixed layout with wrapping cells: a long path or comment wraps inside its column, so the
             table never grows past the pane and nothing scrolls sideways at any width. In a narrow
             pane the columns stack: each row reads as its name over its value. -->
        <DataTable.Root class="w-full table-fixed @max-sm:block">
          <colgroup>
            {#each group.columns as column, index (column)}
              <col class={columnWidth(group, index)} />
            {/each}
          </colgroup>
          <DataTable.Header class="@max-sm:block">
            <DataTable.Row class="@max-sm:block">
              <DataTable.Head colspan={group.columns.length} class="whitespace-normal @max-sm:block @max-sm:h-auto @max-sm:py-8">
                <span class="flex items-center gap-12">
                  <Checkbox
                    id={boxId}
                    aria-label={`Remove ${group.title}`}
                    checked={ticked.has(group.switch)}
                    disabled={cleaning}
                    onCheckedChange={(on) => setTicked(group.switch, on === true)}
                  />
                  <Label for={boxId} class="cursor-pointer font-semibold text-text-default">{group.title}</Label>
                </span>
              </DataTable.Head>
            </DataTable.Row>
            <DataTable.Row class="@max-sm:hidden">
              {#each group.columns as column (column)}
                <DataTable.Head>{column}</DataTable.Head>
              {/each}
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body class="@max-sm:block">
            {#each group.rows as row (row.key)}
              <DataTable.Row class="@max-sm:block">
                {#each row.cells as cell, index (index)}
                  <DataTable.Cell
                    class={cellClass(cell, index)}
                  >
                    {#if cell.datetime !== undefined}
                      <time datetime={cell.datetime}>{cell.text}</time>
                    {:else}
                      {cell.text}
                    {/if}
                    {#if cell.note !== undefined}
                      <span class="mt-4 block text-xs text-text-muted">{cell.note}</span>
                    {/if}
                  </DataTable.Cell>
                {/each}
              </DataTable.Row>
            {/each}
          </DataTable.Body>
        </DataTable.Root>
      {/each}
    </div>

    <div class="flex flex-wrap items-center gap-16 border-t border-border-default pt-16">
      <Button variant="primary" size="sm" disabled={cleaning || ticked.size === 0} onclick={saveCleanCopy}>
        <Eraser class="size-16" aria-hidden="true" />
        {cleaning ? "Making the Copy" : "Save a Clean Copy"}
      </Button>
      {#if onAddFiles !== undefined}
        <Button variant="secondary" size="sm" disabled={cleaning || ticked.size === 0} onclick={putCleanCopyOnBench}>
          <FilePlus class="size-16" aria-hidden="true" />
          Put the Copy on the Bench
        </Button>
      {/if}
      <span class="text-sm text-text-subtle">
        {ticked.size} of {groups.length} {groups.length === 1 ? "kind" : "kinds"} will be removed{ticked.has("trackedChanges")
          ? ", and tracked changes are accepted as they read now"
          : ""}. The original is not changed.
      </span>
      {#if cleanFailure !== null}
        <Badge variant="danger">{cleanFailure}</Badge>
      {:else if clean !== null}
        {#if clean.remaining === 0}
          <Badge variant="success">The copy was read again and carries none of what was ticked</Badge>
        {:else}
          <Badge variant="danger">The copy still carries {clean.remaining} of the ticked kinds</Badge>
        {/if}
      {/if}
    </div>
  </div>
{/if}
