<script lang="ts">
  /*
   * Who served the measurement, and who you are to them — the same four facts Cloudflare's own
   * speed test states. The round trip to Magna Carta sits beside them because that is the one
   * thing their page cannot tell you.
   */
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { formatMilliseconds } from "./speed-test-format.ts";
  import { ABSENT_MARKER, ABSENT_DESCRIPTION } from "./absence.ts";
  import { ipVersion, type MeasurementServer } from "./speed-test-meta.ts";
  import type { ProbeOutcome } from "./connection-probe.ts";

  let {
    meta,
    probe,
  }: { meta: MeasurementServer | null; probe: ProbeOutcome | null } = $props();

  /*
   * The four facts as terms, present before the server has answered, so the list stands in its
   * shape and each value lands where its term already is. A value not yet measured takes the
   * tool's one absence marker, the same one every other reading on the page takes.
   */
  const facts = $derived([
    { term: "Connected via", value: meta === null ? null : ipVersion(meta.clientIp) },
    { term: "Server location", value: meta === null ? null : `${meta.coloCity} (${meta.coloIata})` },
    { term: "Your network", value: meta === null ? null : `${meta.asOrganization} (AS${meta.asn})` },
    { term: "Your IP address", value: meta === null ? null : meta.clientIp },
  ]);
</script>

<DefinitionList.Root>
  {#each facts as fact (fact.term)}
    <DefinitionList.Row term={fact.term}>
      {#if fact.value === null}
        <span aria-label={`${fact.term}: ${ABSENT_DESCRIPTION}`}>{ABSENT_MARKER}</span>
      {:else}
        {fact.value}
      {/if}
    </DefinitionList.Row>
  {/each}
  {#if meta === null}
    <DefinitionList.Empty>The measurement server has not identified itself.</DefinitionList.Empty>
  {/if}
</DefinitionList.Root>

<div class="mt-16">
  {#if probe === null}
    <p class="text-sm">
      <span class="text-text-muted">Round trip to Magna Carta</span>
      <span class="ml-8" aria-label={`Round trip to Magna Carta: ${ABSENT_DESCRIPTION}`}>{ABSENT_MARKER}</span>
    </p>
  {:else if probe.status === "unauthenticated"}
    <p class="text-sm text-text-muted">
      You are not signed in, so the round trip to Magna Carta was not measured. This says nothing
      about your connection.
    </p>
  {:else if probe.status === "forbidden"}
    <p class="text-sm text-text-muted">
      You don't have permission to run this check, so the connection to Magna Carta wasn't measured. Your connection is unaffected.
    </p>
  {:else if probe.status === "unreachable"}
    <p class="text-sm text-text-muted">
      Magna Carta could not be reached from this network. The measurements above still describe
      your internet connection.
    </p>
  {:else}
    <p class="text-sm">
      <span class="text-text-muted">Round trip to Magna Carta</span>
      <span class="ml-8">{formatMilliseconds(probe.medianRoundTripMs ?? undefined)}</span>
    </p>
    <p class="mt-4 text-xs text-text-muted">
      Measured with a real signed-in request, median of {probe.successfulSamples} samples. A good result here with poor bandwidth means your connection is the limit, not Magna Carta.
    </p>
  {/if}
</div>
