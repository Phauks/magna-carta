<script lang="ts">
  /*
   * Settings · Versions — read-only platform diagnostics in the engraved-table framing: one
   * quiet ledger of every versioned component in the deployment. Two kinds of rows:
   *
   * - The app build is baked in at build time (build-identity.ts) — always real, never fetched.
   * - The backend components (scan engine, editing container, conversion engines, PDF engine)
   *   have no aggregated versions endpoint yet (see docs/research/fable-backend-review-2026-07.md,
   *   "Open"). The one current exposure is the scan-policy score-histogram route, whose
   *   engineVersion is the scan container's composite
   *   `engine/<code>+yara-rules/<tag>+clamav-db/<db>` (containers/scan/src/lib.rs) — we fetch it
   *   opportunistically and decompose it into the three separable rows. It is gated behind
   *   firm:manageScanPolicy, so most members (and every environment without a deployed scan
   *   engine) fall through to the honest em-dash seam — never a faked number. When the
   *   aggregated endpoint ships, this page swaps the fetch and the seam rows light up.
   *
   * While that read is out the Platform services list is a LoadingRegion over the same list with
   * sample versions in the scan engine's three rows; the seam rows stay real inside the fixture,
   * because a dash is an honest answer and must never read as a value on its way.
   *
   * The masthead carries no History trigger: this page has no ledger section — versions are
   * reported facts, not user changes, and an always-empty trail would state something untrue
   * about where their history lives (it is the platform's deploy log, not this device). The
   * posture badge is overridden to "Reported by the platform" for the same honesty: nothing
   * here is managed, it is observed.
   *
   * The dl keeps its own plate framing (rather than the settings-plate component) because its
   * rows are definition-list semantics, not setting rows — same rules, same voice, different
   * element; settings-plate.svelte is the reference for the recipe.
   */
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleCivilDate } from "@magna-carta/design-system/loading-fixtures";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import { BUILD_IDENTITY } from "$lib/build-identity.ts";
  import { ECOSYSTEM_SITES } from "$lib/navigation/ecosystem-sites.ts";

  // A version number is a question ("what changed?") — when the public changelog site goes
  // live (its href in the ecosystem registry is the light-up switch), every version value on
  // this page becomes a link there (owner request 2026-07-02). Until then values render as
  // plain text; nothing here to update when the site ships.
  const changelogHref =
    ECOSYSTEM_SITES.find((site) => site.id === "changelog")?.href ?? null;

  type ScanEngineParts = {
    engineCode: string;
    yaraRuleset: string;
    malwareDefinitions: string;
  };

  type ScanEngineState =
    | { status: "loading" }
    | { status: "reported"; parts: ScanEngineParts }
    | { status: "unreported" };

  let scanEngine = $state<ScanEngineState>({ status: "loading" });

  /** Sample words for the loading fixture: plausible shapes for the three scan engine rows. */
  const SCAN_ENGINE_FIXTURE: ScanEngineParts = {
    engineCode: "3.7.1",
    yaraRuleset: sampleCivilDate(0),
    malwareDefinitions: "27544",
  };

  /**
   * Splits the scan container's composite version string back into its three separable
   * components. Returns null when the string does not carry all three — a partial decompose
   * would invite mislabeled numbers.
   */
  function decomposeEngineVersion(composite: string): ScanEngineParts | null {
    const parts = new Map<string, string>();
    for (const component of composite.split("+")) {
      const separator = component.indexOf("/");
      if (separator > 0) parts.set(component.slice(0, separator), component.slice(separator + 1));
    }
    const engineCode = parts.get("engine");
    const yaraRuleset = parts.get("yara-rules");
    const malwareDefinitions = parts.get("clamav-db");
    if (engineCode === undefined || yaraRuleset === undefined || malwareDefinitions === undefined) {
      return null;
    }
    return { engineCode, yaraRuleset, malwareDefinitions };
  }

  async function readScanEngineVersion(): Promise<void> {
    try {
      const response = await fetch("/api/v1/firm/scan-policy/score-histogram", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        scanEngine = { status: "unreported" };
        return;
      }
      const body = (await response.json()) as { engineVersion?: string | null };
      const parts =
        typeof body.engineVersion === "string" ? decomposeEngineVersion(body.engineVersion) : null;
      scanEngine = parts === null ? { status: "unreported" } : { status: "reported", parts };
    } catch {
      // Network failure, non-JSON body (a dev server without the worker), … — the seam row.
      scanEngine = { status: "unreported" };
    }
  }

  void readScanEngineVersion();

  const builtAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(BUILD_IDENTITY.builtAt));
</script>

<svelte:head>
  <title>Versions · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="versions"
  title="Versions"
  meta="What is running: every versioned component of the platform, in one place."
  posture="readOnly"
  badgeLabel="Reported by the platform"
  showHistory={false}
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. Full canvas width (owner-directed): the table uses the space. -->
<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
  <!-- `keep` marks a row that stays real inside a loading fixture: a seam row's dash is an
       answer, not a value on its way. -->
  {#snippet row(component: string, version: string | null, asOf: string | null, keep: boolean)}
    <!-- The shared table grid: the (empty) marker gutter, the flexible label, and the value at
         the fixed control-column measure — so diagnostic values share the settings rows'
         vertical edge. -->
    <div class="flex items-baseline gap-16 py-12" data-loading-keep={keep ? "" : undefined}>
      <div class="shrink-0" style="inline-size: var(--mc-space-16)"></div>
      <FieldLabel as="dt" class="min-w-0 grow"
      >
        {component}
      </FieldLabel>
      <dd
        class="flex shrink-0 flex-col items-end gap-4 text-end"
        style="inline-size: var(--mc-size-popover)"
      >
        {#if version !== null && changelogHref !== null}
          <a
            href={changelogHref}
            {...opensBeside("external")}
            class="text-sm text-text-default tabular-nums underline decoration-border-default underline-offset-4 hover:decoration-current"
          >
            {version}
          </a>
        {:else}
          <span class="text-sm text-text-default tabular-nums">{version ?? "—"}</span>
        {/if}
        {#if asOf !== null}
          <span class="text-xs text-text-muted">as of {asOf}</span>
        {/if}
      </dd>
    </div>
  {/snippet}

  <!-- The platform services list, drawn once for the fixture (over the sample parts, seams kept
       real) and once for the read's answer. -->
  {#snippet platformServicesList(scan: ScanEngineParts | null, keepSeams: boolean)}
    <dl class="flex flex-col divide-y divide-border-default border-b border-border-strong">
      {@render row("Scan Engine · Code", scan?.engineCode ?? null, null, false)}
      {@render row("Scan Engine · YARA Ruleset", scan?.yaraRuleset ?? null, null, false)}
      {@render row("Scan Engine · Malware Definitions", scan?.malwareDefinitions ?? null, null, false)}
      {@render row("Document Editing Container", null, null, keepSeams)}
      {@render row("Conversion Engines", null, null, keepSeams)}
      {@render row("PDF Engine", null, null, keepSeams)}
    </dl>
  {/snippet}

  <section class="flex flex-col">
    <FieldLabel as="h3" class="border-b border-border-strong pb-8"
    >
      Application
    </FieldLabel>
    <dl class="flex flex-col divide-y divide-border-default border-b border-border-strong">
      {@render row(
        "Application Build",
        `${BUILD_IDENTITY.commit} · ${BUILD_IDENTITY.mode}`,
        builtAt,
        false,
      )}
    </dl>
  </section>

  <section class="flex flex-col">
    <FieldLabel as="h3" class="border-b border-border-strong pb-8"
    >
      Platform services
    </FieldLabel>
    <LoadingRegion
      loading={scanEngine.status === "loading"}
      label="Reading the scan engine's versions"
      onRetry={() => void readScanEngineVersion()}
      class="flex flex-col"
    >
      {#snippet fixture()}
        {@render platformServicesList(SCAN_ENGINE_FIXTURE, true)}
      {/snippet}
      {@render platformServicesList(
        scanEngine.status === "reported" ? scanEngine.parts : null,
        false,
      )}
    </LoadingRegion>
  </section>

  <p class="text-sm text-text-muted">
    Reported by the platform once the versions endpoint ships.
  </p>
  </div>
</div>
