<script lang="ts">
  /*
   * One report as a catalogue row: the family's glyph, the name, the question it answers, and the
   * maturity mark at the end. A built report is a link to its run screen; a soon report is not a
   * link, wears the Soon mark, and says on the row what it waits on, because the standing rule is
   * that a designed-but-unwired surface ships visible and honest, never omitted and never fake-live.
   */
  import type { Component } from "svelte";
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import { isBuiltReport, reportHref, type ReportDeclaration } from "./report-registry.ts";

  let { report, icon: Icon }: { report: ReportDeclaration; icon: Component } = $props();
</script>

{#snippet body()}
  <div class="flex items-center gap-16 px-16 py-12">
    <Icon class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
    <span class="shrink-0 font-medium">{report.name}</span>
    <span class="min-w-0 truncate text-sm text-text-muted" title={report.answers}>
      {report.answers}
    </span>
    <span class="ml-auto flex shrink-0 items-center gap-8">
      {#if !isBuiltReport(report)}
        <span class="text-xs text-text-muted">{soonDependencySentence(report.waitsOn)}</span>
      {/if}
      <MaturityBadge stage={report.stage} />
    </span>
  </div>
{/snippet}

{#if isBuiltReport(report)}
  <a href={reportHref(report)} class="block hover:bg-surface-raised">{@render body()}</a>
{:else}
  <div aria-disabled="true">{@render body()}</div>
{/if}
