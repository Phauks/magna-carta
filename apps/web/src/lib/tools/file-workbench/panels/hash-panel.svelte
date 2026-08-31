<script lang="ts">
  /*
   * The file's digests, and the field for checking one against a digest someone sent you.
   *
   * These are computed here, in this browser, over the bytes you handed the page. That is the right
   * figure for a workbench where nothing is filed, and it is not the figure that would go into a
   * record: a digest in a record is computed by the server over the bytes the server received. The
   * panel says so rather than letting the two be taken for the same thing.
   */
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Copy from "@lucide/svelte/icons/copy";
  import FactTable, { type Fact } from "../parts/fact-table.svelte";
  import Absence from "../parts/absence.svelte";
  import SectionHeading from "../parts/section-heading.svelte";
  import {
    BROWSER_DIGEST_ALGORITHMS,
    digestMatches,
    type BrowserDigests,
  } from "../digest.ts";
  import { formatExactBytes, outcomeFor, type WorkbenchFile } from "../workbench-file.ts";
  import type { CapabilityPanelProps } from "../capability.ts";

  let { file }: CapabilityPanelProps = $props();

  const HASH_CAPABILITY = "hash";
  const outcome = $derived(outcomeFor<BrowserDigests>(file, HASH_CAPABILITY));
  const digests = $derived(outcome.kind === "result" ? outcome.value : null);

  let pasted = $state("");
  // Cleared when the file in focus changes: a comparison left standing from the previous file is
  // the kind of stale answer that gets read as this file's.
  $effect(() => {
    void file.id;
    pasted = "";
  });

  const comparison = $derived.by(() => {
    const candidate = pasted.trim();
    if (candidate === "" || digests === null) return null;
    const matched = BROWSER_DIGEST_ALGORITHMS.find((algorithm) =>
      digestMatches(candidate, digests[algorithm]),
    );
    return matched ?? false;
  });

  const facts = $derived.by((): Fact[] => {
    if (!digests) return [];
    return [
      ...BROWSER_DIGEST_ALGORITHMS.map((algorithm) => ({
        label: algorithm,
        value: digests[algorithm],
        mono: true,
      })),
      { label: "Over", value: formatExactBytes(file.sizeBytes) },
      {
        label: "Computed by",
        value: "This browser",
        note: "A digest that goes into a record is computed by the server over the bytes it received.",
      },
    ];
  });

  async function copyDigest(): Promise<void> {
    if (digests) await navigator.clipboard.writeText(digests["SHA-256"]);
  }

  const describe = (target: WorkbenchFile): string => target.name;
</script>

{#if digests}
  <div class="flex flex-col gap-24">
    <FactTable title="Fingerprints" {facts} />

    <div class="flex flex-col gap-8">
      <SectionHeading>Confirm It Has Not Changed</SectionHeading>
      <div class="flex max-w-md flex-col gap-4">
        <Label for="workbench-digest-compare">Paste a digest to compare</Label>
        <Input
          id="workbench-digest-compare"
          class="font-mono"
          bind:value={pasted}
          autocomplete="off"
          spellcheck={false}
        />
        <span class="text-xs text-text-muted">
          Either digest above will match. Case and surrounding space are ignored.
        </span>
      </div>
      {#if comparison === false}
        <Badge variant="danger">No match against {describe(file)}</Badge>
      {:else if comparison}
        <Badge variant="success">Matches the {comparison} digest</Badge>
      {/if}
    </div>

    <div class="flex gap-8">
      <Button variant="secondary" size="sm" onclick={copyDigest}>
        <Copy class="size-16" aria-hidden="true" />
        Copy SHA-256
      </Button>
    </div>
  </div>
{:else if outcome.kind === "failed"}
  <Absence kind="failed" reason={outcome.errorId === undefined ? outcome.message : `${outcome.message} Error ID ${outcome.errorId}.`} />
{:else}
  <Absence kind="not-run" reason="This file has not been read yet." />
{/if}
