<script lang="ts">
  /*
   * ONE SECTION OF THE BUILD INFORMATION PANEL — heading, fold, failure block, loading region.
   *
   * The panel has four subjects (Deployment, Workers, Database, Upload readiness) and every one of
   * them was written out longhand in the chip: the same folding heading, the same "the read failed /
   * Error ID … / status … / Retry" block, the same LoadingRegion wrapping the same shape of fixture.
   * Four copies of a failure block is four places for the wording to drift, and it had already
   * started to — one section said "The API could not be reached" where the identical case in another
   * said nothing at all. It also meant a fifth subject cost a hundred lines of copied markup before
   * it showed a single row.
   *
   * So the frame is here and the rows are the caller's. What a section still decides for itself is
   * what it is called, what its shut heading carries, what its skeleton looks like, and what the
   * lead sentence of its failure says — because "the version read failed" and "the database health
   * read failed" are different sentences and collapsing them would cost the reader the one word that
   * says which read is out.
   *
   * THE FOLD NEVER HIDES A FAULT. That rule is kept jointly: the heading carries the section's pills
   * while it is shut (version-section-heading.svelte), and a section whose read has FAILED renders
   * its failure block whether it is folded or not. A reader who folded Database last week must not
   * be told nothing is wrong because of it.
   */
  import type { Snippet } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import VersionSectionHeading from "./version-section-heading.svelte";
  import type { SectionPill } from "./version-overlay-model.ts";
  import type { PanelReadFailure } from "./panel-report.ts";
  import type { SectionFoldPreference } from "./version-panel-preferences.svelte.ts";

  const {
    label,
    preference,
    pills = [],
    failure = null,
    failureLead,
    onRetry,
    retrying = false,
    loading = false,
    refreshing = false,
    loadingLabel,
    fixture,
    children,
    foldable = true,
  }: {
    label: string;
    /** The remembered fold for this section, from the fold registry. */
    preference: SectionFoldPreference;
    /** What the shut heading carries — a count, always, and a status pill where there is one. */
    pills?: readonly SectionPill[];
    /** This section's own failed read, rendered whether the section is folded or not. */
    failure?: PanelReadFailure | null;
    /** The first line of the failure block when the read answered with a problem. */
    failureLead?: string;
    onRetry?: () => void;
    /** True while a retry is out, so the Retry control cannot be pressed twice. */
    retrying?: boolean;
    /** True while there is no value yet at all — the skeleton stands in. */
    loading?: boolean;
    /** True while a re-ask is out over rows that are already on screen. */
    refreshing?: boolean;
    loadingLabel: string;
    /** Row shapes over sample values, greyed, for the first read. */
    fixture?: Snippet;
    children?: Snippet;
    /**
     * False where something else already names the section and decides whether it shows — a tab
     * on the System Status page. The section then has no heading and no fold of its own; a fold
     * inside a tab would be a second way to hide what the tab was opened to show.
     */
    foldable?: boolean;
  } = $props();

  const collapsed = $derived(foldable && preference.collapsed);

  // Whether there is anything at all to put inside the loading region: rows, or a skeleton standing
  // in for rows that have not arrived. A section with neither renders its heading and stops, rather
  // than an empty bordered region that reads as a surface that failed to draw — and a section whose
  // read FAILED shows its failure above and no skeleton at all, because a skeleton that will never
  // fill is the stall this component's caller already has a better answer for.
  const hasBody = $derived(
    children !== undefined && (!loading || (fixture !== undefined && failure === null)),
  );
</script>

{#if foldable}
  <VersionSectionHeading
    {label}
    collapsed={preference.collapsed}
    toggle={() => preference.toggle()}
    {pills}
  />
{/if}

{#if failure !== null}
  <!-- OUTSIDE the fold, deliberately. Folding a section is a statement about how much detail the
       reader wants, never a statement that its read succeeded. -->
  <div class="flex flex-col gap-4">
    <p class="text-sm text-text-default">
      {failure.kind === "problem"
        ? (failureLead ?? "The read failed.")
        : "The API could not be reached."}
    </p>
    {#if failure.kind === "problem"}
      <!-- The Error ID is the handle support correlates on; "not yet assigned" is itself a finding,
           so it is stated rather than leaving the line out. -->
      <p class="text-xs text-text-muted">
        Error ID: {failure.problem.errorId ?? "not yet assigned"} · status {failure.problem.status}
      </p>
    {/if}
    {#if onRetry !== undefined}
      <div>
        <Button variant="secondary" size="sm" disabled={retrying} onclick={onRetry}>Retry</Button>
      </div>
    {/if}
  </div>
{/if}

{#if !collapsed && hasBody}
  <!-- The region's own `failed`/`failure` snippets are deliberately unused: they render the failure
       INSIDE the region, which is inside the fold, and this panel's rule is that folding never hides
       a fault. The block above sits outside both. -->
  <LoadingRegion
    {loading}
    {refreshing}
    {fixture}
    {onRetry}
    label={loadingLabel}
    class="flex flex-col gap-8"
  >
    {@render children?.()}
  </LoadingRegion>
{/if}
