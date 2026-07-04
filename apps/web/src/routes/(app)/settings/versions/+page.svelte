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
  import Skeleton from "@magna-carta/design-system/skeleton";
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
<div class="min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
  {#snippet row(component: string, version: string | null, asOf: string | null)}
    <!-- The shared table grid: the (empty) marker gutter, the flexible label, and the value at
         the fixed control-column measure — so diagnostic values share the settings rows'
         vertical edge. -->
    <div class="flex items-baseline gap-16 py-12">
      <div class="shrink-0" style="inline-size: var(--mc-space-16)"></div>
      <dt
        class="min-w-0 grow text-xs text-text-muted uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        {component}
      </dt>
      <dd
        class="flex shrink-0 flex-col items-end gap-4 text-end"
        style="inline-size: var(--mc-size-popover)"
      >
        {#if version !== null && changelogHref !== null}
          <a
            href={changelogHref}
            target="_blank"
            rel="noreferrer noopener"
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

  {#snippet loadingRow(component: string)}
    <div class="flex items-baseline gap-16 py-12">
      <div class="shrink-0" style="inline-size: var(--mc-space-16)"></div>
      <dt
        class="min-w-0 grow text-xs text-text-muted uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        {component}
      </dt>
      <dd class="flex shrink-0 justify-end" style="inline-size: var(--mc-size-popover)">
        <Skeleton class="h-16 w-96" />
      </dd>
    </div>
  {/snippet}

  <section class="flex flex-col">
    <h3
      class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
      style="letter-spacing: var(--mc-tracking-caps)"
    >
      Application
    </h3>
    <dl class="flex flex-col divide-y divide-border-default border-b border-border-strong">
      {@render row(
        "Application Build",
        `${BUILD_IDENTITY.commit} · ${BUILD_IDENTITY.mode}`,
        builtAt,
      )}
    </dl>
  </section>

  <section class="flex flex-col">
    <h3
      class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
      style="letter-spacing: var(--mc-tracking-caps)"
    >
      Platform services
    </h3>
    <dl
      class="flex flex-col divide-y divide-border-default border-b border-border-strong"
      aria-busy={scanEngine.status === "loading"}
    >
      {#if scanEngine.status === "loading"}
        {@render loadingRow("Scan Engine · Code")}
        {@render loadingRow("Scan Engine · YARA Ruleset")}
        {@render loadingRow("Scan Engine · Malware Definitions")}
      {:else if scanEngine.status === "reported"}
        {@render row("Scan Engine · Code", scanEngine.parts.engineCode, null)}
        {@render row("Scan Engine · YARA Ruleset", scanEngine.parts.yaraRuleset, null)}
        {@render row("Scan Engine · Malware Definitions", scanEngine.parts.malwareDefinitions, null)}
      {:else}
        {@render row("Scan Engine · Code", null, null)}
        {@render row("Scan Engine · YARA Ruleset", null, null)}
        {@render row("Scan Engine · Malware Definitions", null, null)}
      {/if}

      {@render row("Document Editing Container", null, null)}
      {@render row("Conversion Engines", null, null)}
      {@render row("PDF Engine", null, null)}
    </dl>
  </section>

  <p class="text-sm text-text-muted">
    Reported by the platform once the versions endpoint ships.
  </p>
  </div>
</div>
