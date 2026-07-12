<script lang="ts">
  /*
   * Who served the measurement, and who you are to them — the same four facts Cloudflare's own
   * speed test states. The round trip to Magna Carta sits beside them because that is the one
   * thing their page cannot tell you.
   */
  import { formatMilliseconds } from "./speed-test-format.ts";
  import { ABSENT_MARKER, ABSENT_DESCRIPTION } from "./absence.ts";
  import { ipVersion, type MeasurementServer } from "./speed-test-meta.ts";
  import type { ProbeOutcome } from "./connection-probe.ts";

  let {
    meta,
    probe,
  }: { meta: MeasurementServer | null; probe: ProbeOutcome | null } = $props();
</script>

{#if meta === null}
  <p class="text-sm text-text-muted">The measurement server has not identified itself.</p>
{:else}
  <dl class="grid grid-cols-1 gap-16 text-sm sm:grid-cols-2">
    <div><dt class="text-text-muted">Connected via</dt><dd>{ipVersion(meta.clientIp)}</dd></div>
    <div>
      <dt class="text-text-muted">Server location</dt>
      <dd>{meta.coloCity} ({meta.coloIata})</dd>
    </div>
    <div>
      <dt class="text-text-muted">Your network</dt>
      <dd>{meta.asOrganization} (AS{meta.asn})</dd>
    </div>
    <div><dt class="text-text-muted">Your IP address</dt><dd>{meta.clientIp}</dd></div>
  </dl>
{/if}

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
      Your account does not carry permission to run this check, so the round trip to Magna Carta
      was not measured. Your connection is unaffected.
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
      Measured as a real authenticated request, median of {probe.successfulSamples} samples. A
      healthy round trip here alongside poor bandwidth means the connection, not the platform, is
      the constraint.
    </p>
  {/if}
</div>
