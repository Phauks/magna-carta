<script lang="ts">
  /*
   * The file's digests, and the field for checking one against a digest someone sent you.
   *
   * The digests themselves are DigestList, the design system's one recipe for showing them — the
   * same component the matter file's inspector shows its five in. Two surfaces drawing the same
   * reading two ways is how they drift, and this one had already grown its own spacing, its own
   * pending state and a copy button in a different place.
   *
   * WHERE THESE CAME FROM IS NOT A ROW HERE. It used to be: a "Computed by — This browser" row
   * under the digests. The masthead already says nothing leaves this browser, which covers every
   * reading on the screen, and repeating it per panel says the same thing five times over.
   */
  import DigestList, { type DigestEntry } from "@magna-carta/design-system/digest-list";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Badge from "@magna-carta/design-system/badge";
  import Absence from "../parts/absence.svelte";
  import SectionHeading from "../parts/section-heading.svelte";
  import { BROWSER_DIGEST_ALGORITHMS, digestMatches, type BrowserDigests } from "../digest.ts";
  import { outcomeFor, type WorkbenchFile } from "../workbench-file.ts";
  import type { CapabilityPanelProps } from "../capability.ts";

  let { file }: CapabilityPanelProps = $props();

  const HASH_CAPABILITY = "hash";
  const outcome = $derived(outcomeFor<BrowserDigests>(file, HASH_CAPABILITY));
  const digests = $derived(outcome.kind === "result" ? outcome.value : null);

  const entries = $derived(
    BROWSER_DIGEST_ALGORITHMS.map(
      (algorithm): DigestEntry => ({ algorithm, value: digests?.[algorithm] ?? null }),
    ),
  );

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

  async function copy(entry: DigestEntry): Promise<void> {
    if (entry.value !== null) await navigator.clipboard.writeText(entry.value);
  }

  const describe = (target: WorkbenchFile): string => target.name;
</script>

{#if digests}
  <div class="flex flex-col gap-24">
    <div class="flex flex-col gap-8">
      <SectionHeading>Fingerprints</SectionHeading>
      <DigestList digests={entries} onCopy={(entry) => void copy(entry)} />
    </div>

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
  </div>
{:else if outcome.kind === "failed"}
  <Absence
    kind="failed"
    reason={outcome.errorId === undefined
      ? outcome.message
      : `${outcome.message} Error ID ${outcome.errorId}.`}
  />
{:else}
  <Absence kind="not-run" reason="This file has not been read yet." />
{/if}
