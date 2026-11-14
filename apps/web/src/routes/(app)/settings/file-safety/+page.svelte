<script lang="ts">
  /*
   * Settings · File Safety & Scanning — the firm's stance toward what its uploads are allowed to
   * do, under Documents.
   *
   * LIVE, over GET/PATCH /api/v1/firm/scan-policy. The per-firm scan-policy engine was already
   * there — the ingest consumer reads it at queue-consume time and the download route reads it at
   * access time — so what changes here reaches both without re-ingesting anything, and a save is
   * audited by the route rather than remembered by this browser.
   *
   * THE STANDARD PAGE, WITH ONE THING BENEATH ONE ROW. The rows, the footer's pending count and
   * its confirmation recap are the settings surface's own anatomy (settings-page.svelte over the
   * shared server-backed draft). What this page adds sits beneath Scan Depth: the engine every
   * upload is scanned by, as it reports itself, and under it what the CHOSEN depth's rules are —
   * revealed by the choice, so a depth is never explained inside the one-line option a person has
   * to read it from. The engine's composite version is read from the score-histogram route, the
   * one place the engine states it, behind the same permission the policy read names.
   *
   * WHAT THE DEPTH ROW CAN AND CANNOT SAY. Its meaning is stated from the verdict model and the
   * engine's own build notes (scan-policy-draft.svelte.ts, scanTierMeaning). The rule families
   * inside each depth are the upstream release's and are reported by nothing yet, so that line
   * ships as the honest Soon seam rather than a list somebody invented.
   *
   * HISTORY IS WITHHELD, for the reason the calendar page withholds it: the record of a change is
   * the audit row the server writes, and a per-browser ledger would be one browser's recollection
   * of a firm-wide fact, silent about every change a colleague made.
   *
   * THE THRESHOLD IS A NUMBER HERE, AND WANTS TO BE A PLOT. The engine publishes the score
   * distribution of its own rule corpus (`/api/v1/firm/scan-policy/score-histogram`), which is what
   * makes a threshold answerable rather than a number in a vacuum — a firm should be able to see
   * how many rules it is about to start trusting. That control is its own piece of work; until it
   * lands the field is the plain number, which is honest and settable, rather than absent.
   */
  import Badge from "@magna-carta/design-system/badge";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import {
    createScanPolicyDraft,
    FILE_SAFETY_DEFINITIONS,
    FILE_SAFETY_SECTION_ID,
    SCAN_ENGINE_DEFINITION,
    SCAN_TIER_DEFINITION,
    SCAN_TIER_RULES_SOON_LINE,
    scanTierFromValue,
    scanTierRulesDefinition,
  } from "$lib/file-manager/scan-policy-draft.svelte.ts";
  import {
    MANAGE_SCAN_POLICY_PERMISSION,
    readScanEngineVersion,
  } from "$lib/file-manager/scan-policy-api.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import SettingsPage from "$lib/settings/components/settings-page.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import {
    decomposeScanEngineVersion,
    SCAN_ENGINE_FIXTURE_PARTS,
    SCAN_ENGINE_UNREPORTED_DETAIL,
    SCAN_ENGINE_UNREPORTED_LABEL,
    scanEngineReadingLines,
    type ScanEngineParts,
  } from "$lib/versions/scan-engine-version.ts";

  const draft = createScanPolicyDraft(fetch);

  // Read-only until the session says otherwise: a control that appears and then vanishes when the
  // permission turns out to be missing reads as a broken page.
  const canEdit = $derived(sessionPermissions.holds(MANAGE_SCAN_POLICY_PERMISSION));

  type ScanEngineState =
    | { status: "loading" }
    | { status: "reported"; parts: ScanEngineParts }
    | { status: "unreported" };

  let scanEngine = $state<ScanEngineState>({ status: "loading" });

  async function readEngine(): Promise<void> {
    scanEngine = { status: "loading" };
    const outcome = await readScanEngineVersion(fetch);
    if (outcome.kind !== "ok" || outcome.value.engineVersion === null) {
      scanEngine = { status: "unreported" };
      return;
    }
    const parts = decomposeScanEngineVersion(outcome.value.engineVersion);
    scanEngine = parts === null ? { status: "unreported" } : { status: "reported", parts };
  }

  $effect(() => {
    void sessionPermissions.load(fetch);
    void readEngine();
  });

  // The depth the reader has CHOSEN, staged or committed: the rules row follows the choice as it
  // is made, which is what makes choosing reveal rather than describe after the fact.
  const chosenTier = $derived(scanTierFromValue(draft.stagedValue(SCAN_TIER_DEFINITION)));
  const rulesDefinition = $derived(scanTierRulesDefinition(chosenTier));
</script>

<svelte:head>
  <title>File Safety & Scanning · Settings · Magna Carta</title>
</svelte:head>

{#snippet engineReading(parts: ScanEngineParts)}
  <dl class="flex flex-col items-end gap-4 text-sm">
    {#each scanEngineReadingLines(parts) as line (line.label)}
      <div class="flex items-baseline gap-8">
        <dt class="text-text-muted">{line.label}</dt>
        <dd class="font-mono tabular-nums">{line.value}</dd>
      </div>
    {/each}
  </dl>
{/snippet}

{#snippet afterRow(definition: SettingDefinition)}
  {#if definition.id === SCAN_TIER_DEFINITION.id}
    <!-- The engine beneath the depth that runs against it, then what the chosen depth means. -->
    <LoadingRegion
      loading={scanEngine.status === "loading"}
      label="Reading the scan engine's version"
      onRetry={() => void readEngine()}
      class="flex flex-col divide-y divide-border-default"
    >
      {#snippet fixture()}
        <SettingsRow definition={SCAN_ENGINE_DEFINITION}>
          {#snippet control()}
            {@render engineReading(SCAN_ENGINE_FIXTURE_PARTS)}
          {/snippet}
        </SettingsRow>
      {/snippet}
      <SettingsRow definition={SCAN_ENGINE_DEFINITION}>
        {#snippet control()}
          {#if scanEngine.status === "reported"}
            {@render engineReading(scanEngine.parts)}
          {:else}
            <div class="flex flex-col items-end gap-4">
              <Badge variant="neutral">{SCAN_ENGINE_UNREPORTED_LABEL}</Badge>
              <p class="text-end text-xs text-text-muted">{SCAN_ENGINE_UNREPORTED_DETAIL}</p>
            </div>
          {/if}
        {/snippet}
      </SettingsRow>
    </LoadingRegion>
    <SettingsRow definition={rulesDefinition}>
      {#snippet control()}
        <!-- The rule families are designed-but-unwired: the anatomy ships with the Soon device and
             the one honest line saying what it waits on, never an invented list. -->
        <div class="flex flex-col items-end gap-4">
          <Badge variant="neutral">Soon</Badge>
          <p class="text-end text-xs text-text-muted">{SCAN_TIER_RULES_SOON_LINE}</p>
        </div>
      {/snippet}
    </SettingsRow>
  {/if}
{/snippet}

<SettingsPage
  sectionId={FILE_SAFETY_SECTION_ID}
  title="File Safety & Scanning"
  meta="How the firm's uploads are scanned, and what it can do with a file the scan distrusts."
  {draft}
  definitions={FILE_SAFETY_DEFINITIONS}
  {canEdit}
  readLabel="Reading the firm's scan policy"
  readFailureTitle="The Scan Policy Could Not Be Read"
  readFailureFallback="The firm's scan policy was not read."
  saveFailureFallback="The scan policy is unchanged. What you chose is still staged."
  saveFailureWhenSilent="Couldn't connect. The scan policy is unchanged, and your choices are still here."
  {afterRow}
/>
