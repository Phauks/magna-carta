<script lang="ts">
  /*
   * Settings · Versions — read-only platform diagnostics: one quiet ledger of every versioned
   * component in the deployment. Two kinds of rows:
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
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Skeleton from "@magna-carta/design-system/skeleton";
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

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Eyebrow>Settings</Masthead.Eyebrow>
    <Masthead.Title>Versions</Masthead.Title>
    <Masthead.Meta>
      <span>What is running: every versioned component of the platform, in one place.</span>
    </Masthead.Meta>
  </Masthead.Heading>
</Masthead.Root>

<div class="flex flex-col gap-16" style="max-inline-size: var(--mc-size-prose)">
  <dl
    class="flex flex-col divide-y divide-border-default"
    aria-busy={scanEngine.status === "loading"}
  >
    {#snippet row(component: string, version: string | null, asOf: string | null)}
      <div class="flex items-baseline justify-between gap-24 py-12">
        <dt
          class="text-xs text-text-muted uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          {component}
        </dt>
        <dd class="flex flex-col items-end gap-4 text-end">
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
      <div class="flex items-baseline justify-between gap-24 py-12">
        <dt
          class="text-xs text-text-muted uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          {component}
        </dt>
        <dd><Skeleton class="h-16 w-96" /></dd>
      </div>
    {/snippet}

    {@render row("Application build", `${BUILD_IDENTITY.commit} · ${BUILD_IDENTITY.mode}`, builtAt)}

    {#if scanEngine.status === "loading"}
      {@render loadingRow("Scan engine · code")}
      {@render loadingRow("Scan engine · YARA ruleset")}
      {@render loadingRow("Scan engine · malware definitions")}
    {:else if scanEngine.status === "reported"}
      {@render row("Scan engine · code", scanEngine.parts.engineCode, null)}
      {@render row("Scan engine · YARA ruleset", scanEngine.parts.yaraRuleset, null)}
      {@render row("Scan engine · malware definitions", scanEngine.parts.malwareDefinitions, null)}
    {:else}
      {@render row("Scan engine · code", null, null)}
      {@render row("Scan engine · YARA ruleset", null, null)}
      {@render row("Scan engine · malware definitions", null, null)}
    {/if}

    {@render row("Document editing container", null, null)}
    {@render row("Conversion engines", null, null)}
    {@render row("PDF engine", null, null)}
  </dl>

  <p class="text-sm text-text-muted">
    Reported by the platform once the versions endpoint ships.
  </p>
</div>
