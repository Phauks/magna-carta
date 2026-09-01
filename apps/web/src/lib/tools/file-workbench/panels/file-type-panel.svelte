<script lang="ts">
  /*
   * What the file actually is, against what its name claims.
   *
   * The reading on screen today is the browser's prefix scan (identify.ts). The content service
   * reads the whole file and reports a confidence; both produce a FileTypeReport, so this panel
   * does not change when the source does — which is also why it carries no row saying which of the
   * two answered. The masthead says where the work happens, once, for the whole screen.
   */
  import Badge from "@magna-carta/design-system/badge";
  import type { ExtensionMatch } from "@magna-carta/file-type";
  import FactTable, { type Fact } from "../parts/fact-table.svelte";
  import Absence from "../parts/absence.svelte";
  import { fileTypeOf } from "../file-facts.ts";
  import type { CapabilityPanelProps } from "../capability.ts";

  let { file }: CapabilityPanelProps = $props();

  const identified = $derived(fileTypeOf(file));

  const MATCH: Record<ExtensionMatch, { label: string; variant: "success" | "danger" | "neutral" }> =
    {
      match: { label: "Agrees", variant: "success" },
      mismatch: { label: "Disagrees", variant: "danger" },
      unverifiable: { label: "Not checkable", variant: "neutral" },
      "no-extension": { label: "No extension", variant: "neutral" },
    };

  const facts = $derived.by((): Fact[] => {
    if (!identified) return [];
    const { report, magicBytes } = identified;
    return [
      { label: "Reads as", value: report.detectedLabel },
      {
        label: "Name claims",
        value: report.claimedExtension === null ? "No extension" : `.${report.claimedExtension}`,
        mono: report.claimedExtension !== null,
      },
      { label: "Leading bytes", value: magicBytes, mono: true },
      { label: "Family", value: report.group },
    ];
  });
</script>

{#if identified}
  {@const match = MATCH[identified.report.extensionMatch]}
  <div class="flex flex-col gap-16">
    <div class="flex items-center gap-8">
      <Badge variant={match.variant}>{match.label}</Badge>
      <span class="text-sm text-text-muted">{identified.report.note}</span>
    </div>
    <FactTable title="What the Bytes Say" {facts} />
  </div>
{:else}
  <Absence kind="not-run" reason="This file has not been identified." />
{/if}
