<script lang="ts">
  /*
   * Reports — the catalogue. Every report the platform declares, grouped by family, rendered from
   * the registry: a built report opens its run screen, a soon one is visible, disabled and says what
   * it waits on. The tools listing's shape, because a catalogue of things a member can open is the
   * same kind of screen whatever the things are.
   */
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import ReportRow from "$lib/reports/report-row.svelte";
  import { REPORT_FAMILIES, reportsInFamily } from "$lib/reports/report-registry.ts";
</script>

<svelte:head><title>Reports · Magna Carta</title></svelte:head>

<ScreenHeader title="Reports" class="mb-24" />

<div class="flex flex-col gap-32">
  {#each REPORT_FAMILIES as family (family.id)}
    <section class="flex flex-col gap-16">
      <FieldLabel as="h2" class="border-b border-border-strong pb-8">{family.label}</FieldLabel>
      <ul
        class="divide-y divide-border-default overflow-hidden rounded-lg border border-border-default"
      >
        {#each reportsInFamily(family.id) as report (report.id)}
          <li><ReportRow {report} icon={family.icon} /></li>
        {/each}
      </ul>
    </section>
  {/each}
</div>
