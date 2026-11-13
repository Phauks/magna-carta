<script lang="ts">
  /*
   * The version report — what is running, and whether this firm's records can be reached — as ONE
   * component rendered in two places: the chip's popover (the quick view) and the Versions settings
   * page (the full one, at page size). Both draw from the same models, so the two can never answer
   * the same question differently; the page is this report with more room, not a second
   * implementation. Opening it asks GET /api/v1/meta/versions what every part of the deployment is
   * running.
   *
   * EVERY ROW IS HEADED BY THE CLOUDFLARE WORKER IT REPORTS ON (`magna-carta`, `magna-carta-web`,
   * `magna-carta-scan`, …) and by nothing else: the names arrive from the API's roster, which reads
   * them off the wrangler configs that deploy them, so a row that says "Not reporting" tells the
   * reader exactly which project is silent and no row carries an invented product name. Signed in,
   * that name is a LINK to the Worker in the Cloudflare dashboard (deployment-links.ts): the row
   * already names the thing somebody would go and open, and copying it into another tab by hand was
   * the only step between naming it and opening it.
   *
   * THE PAGE'S OWN BUILD IS NOT A STANDING ROW. It was one, headed "This page", and it duplicated
   * magna-carta-web: that Worker serves the interface, so its commit and timestamps are this page's,
   * said once under a name someone can act on (owner ruling, 2026-08-31 — the reasoning and the
   * fallback rule live on showsPageBuildRow in version-overlay-model.ts). It comes back only where
   * nothing else states this build: signed out, or with the web row silent.
   *
   * THE DEPLOYMENT LIST IS THE WHOLE FLEET. Every dedicated sibling Worker appears, the unbound
   * ones included — a worker missing from the list reads as "everything is listed and healthy",
   * which is worse than an honest "Not deployed" row. The fleet beneath the leading pair folds
   * away and remembers the fold, and a folded heading still counts the Workers that came back
   * without a version, so folding hides rows and never hides a fault.
   *
   * A REPORTED ROW SAYS WHAT THE PROBE COST. The API races every probe against a fixed timeout, so
   * "reported" and "unreachable" are the two ends of one measurement and nothing used to sit between
   * them: a Worker answering just inside the timeout read as perfectly healthy right up to the
   * moment it flipped. The row carries its latency, and a slow one is marked
   * (isSlowProbe in version-overlay-model.ts) — the only state here a reader can act on before it
   * becomes a fault.
   *
   * TWO WORKERS SERVE THE APP'S ADDRESS, split by route pattern: `magna-carta-web` serves the
   * interface (this page included) and `magna-carta` answers the API. They deploy separately, so
   * the two are allowed to differ, and the front rows carry a colour-coded sync badge instead of a
   * fixed sentence — success once they match, warning only when the web build is the one behind
   * (apiWebSyncState in version-overlay-model.ts), neutral for any other difference, since
   * differing is a normal state and not every difference is a fault.
   *
   * THE CHIP NOTICES AN UPSTREAM DEPLOY. SvelteKit's version poll (svelte.config.js names each
   * build by its commit) compares the running bundle against what the deployment serving it is
   * publishing now; when a newer bundle is live the chip carries a warning dot and a Reload control
   * appears in the panel header, beside Refresh, where the panel's other gesture already is. The
   * block that explains it also links to the diff between the two builds, which is the question
   * "a newer deployment is live" raises and nothing answered.
   *
   * THE CHIP SAYS WHICH BUILD MODE IT IS, outside production. Two screenshots of one commit, one
   * from a preview deploy and one from the real site, were indistinguishable, and a fault reported
   * against the wrong deployment costs a whole round of diagnosis. Production carries no badge:
   * that is the assumption a reader already holds.
   *
   * THE PANEL HAS FOUR SUBJECTS, AND THEY ARE NOT ALL ABOUT THE FLEET. "What is running" and
   * "can I reach my firm's records" are different questions with different remedies, and a member
   * whose screens are refusing needs the second one answered: a newly created firm whose member
   * record has not finished being written reads, on every other screen, as a permission somebody
   * forgot to grant. So the Database section asks GET /api/v1/meta/database-health and lays the
   * causes out separately — the connection, the schema, this account's standing in the firm, and
   * any provisioning still in flight. Every word of that reading lives in database-health-model.ts.
   *
   * EVERY SECTION IS THE SAME COMPONENT. Heading, fold, failure block and loading region come from
   * version-panel-section.svelte; what each section still decides is its own name, its own pills,
   * its own skeleton, its own failure sentence and its own rows. Four hand-written copies of that
   * frame is four places for the wording to drift, and it had.
   *
   * EACH SECTION REMEMBERS ITS OWN FOLD. A shut heading still carries what folding it hides — the
   * count of Workers without a version, the worst reading among the health rows — and a section
   * whose read FAILED shows its failure whether it is folded or not, so folding a section never
   * turns it into a claim of health.
   *
   * NEITHER READ HAPPENS UNTIL THE PANEL IS OPENED. The chip is on every screen in the app, and a
   * standing health poll behind it would be a request on every page load to answer a question
   * nobody has asked yet. The update poll is the one exception, and it is an asset read of this
   * bundle's own origin.
   *
   * TWO SCOPES, ONE COMPONENT. Inside a session (`scope="app"`) the panel reports the whole
   * deployment and its firm's database. On the signed-out surfaces (`scope="public"` — sign in, password reset, the
   * joining screens) it reports the page's own build only: that identifier is already inside the
   * bundle the visitor downloaded, so showing it discloses nothing new, while the aggregate is an
   * authenticated read that a signed-out page must not attempt. The update poll still runs there —
   * the version file is a public asset of the same bundle. Links are signed-in too: the repository
   * path and the fleet's Worker names are internal furniture, and a sign-in screen is not the place
   * to publish them.
   *
   * THE PANEL CAN FILE WHAT IT IS SHOWING. Everything here is assembled for somebody else to read,
   * and until now the only way to send it was Copy, close, find the profile menu, paste. Report an
   * Issue opens the same dialog every other surface uses, carrying this panel's whole diagnosis, so
   * the filed report says which builds were live and whether the firm's database was answering.
   * The dialog is mounted by the shell, not here: inside the chip's popover it was a child of the
   * surface that dismisses it ($lib/components/issue-report.svelte.ts).
   *
   * AND IT SAYS WHERE THE SOURCE IS. Every commit named here links to its own diff; the repository
   * those diffs live in was the one address a reader had to already know.
   *
   * Honesty rules the panel keeps:
   * - The build line never comes from the network and the deployment lines never come from
   *   anywhere but the read; a failed read is said out loud with its Error ID, never papered over —
   *   in the paste as well as on the screen.
   * - The service observation is briefly cached server-side, so once it is old enough to matter
   *   the header says when it was actually taken.
   * - A row's state stays separate from its name: "not wired here" / "did not answer" / "answering
   *   from a build too old to say" all survive as the row's own sentence.
   * - A re-ask that fails keeps the rows it already had and says they are the older read's, so
   *   nothing on screen is left looking current when it is not.
   * - Every version is copyable, and a copy that did not happen says so: the clipboard is refused
   *   outright on an insecure origin and under some managed-browser policies, and a control that
   *   swallowed that told a person their report was on the clipboard when it was not. The copy goes
   *   through the design system's own copyText, which falls back to the selection route and reports
   *   which happened.
   * - Nothing is linked that cannot be verified: a commit link needs a repository this build
   *   actually resolved and a commit that is a real stamp, or the row stays plain text.
   */
  import Badge from "@magna-carta/design-system/badge";
  import { sampleInstant } from "@magna-carta/design-system/loading-fixtures";
  import Button from "@magna-carta/design-system/button";
  import Separator from "@magna-carta/design-system/separator";
  import { copyText } from "@magna-carta/design-system/failure-details";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import { GithubMark } from "@magna-carta/design-system/service-marks";
  import MessageSquareWarning from "@lucide/svelte/icons/message-square-warning";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import { page, updated } from "$app/state";
  import { buildPanel } from "$lib/versions/build-panel.svelte.ts";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import { issueReport } from "$lib/components/issue-report.svelte.ts";
  import { requestJson } from "$lib/api/request.ts";
  import { currentEnvironment } from "$lib/diagnostics/current-trace.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import {
    CHECK_UPLOAD_READINESS_PERMISSION,
    checkUploadReadiness,
    type UploadReadinessReport,
  } from "$lib/file-manager/upload-readiness-api.ts";
  import {
    CONNECTED_SERVICES_SECTION_LABEL,
    connectedServiceRow,
    connectedServicesSectionPills,
  } from "./connected-services-model.ts";
  import {
    READINESS_CHECK_IN_FLIGHT_NOTICE,
    UPLOAD_READINESS_SECTION_LABEL,
    uploadReadinessRow,
    uploadReadinessRows,
    uploadReadinessSectionPills,
  } from "./upload-readiness-model.ts";
  import { BUILD_IDENTITY } from "$lib/build-identity.ts";
  import {
    databaseSectionPills,
    type HealthReading,
    databaseHealthRows,
    describeProvisioningBacklog,
    describeSchemaLineage,
    healthBadgeVariant,
    DATABASE_SECTION_LABEL,
    DEPLOYMENT_SECTION_LABEL,
    HEALTH_READ_IN_FLIGHT_NOTICE,
    SIGNED_OUT_DATABASE_NOTICE,
    type DatabaseHealthValue,
  } from "$lib/versions/database-health-model.ts";
  import { PANEL_SECTION_FOLDS } from "$lib/versions/version-panel-preferences.svelte.ts";
  import VersionPanelSection from "$lib/versions/version-panel-section.svelte";
  import { buildPanelReport, type PanelReadFailure } from "$lib/versions/panel-report.ts";
  import {
    commitComparisonUrl,
    commitUrl,
    repositoryUrl,
    workerDashboardUrl,
  } from "$lib/versions/deployment-links.ts";
  import {
    apiWebSyncState,
    copyLineForPart,
    describeObservationAge,
    describeProbeLatency,
    describeRetainedRows,
    findWebWorkerRow,
    formatVersionTimestamp,
    isRealCommit,
    isSlowProbe,
    partitionDeploymentRows,
    readsServiceAggregate,
    serviceStateDescription,
    serviceStateLabel,
    showsPageBuildRow,
    deploymentSectionPills,
    workersSectionPills,
    syncStateBadgeVariant,
    syncStateLabel,
    API_WORKER_UNIT_NAME,
    FLEET_SECTION_LABEL,
    NO_SERVICES_NOTICE,
    PAGE_BUILD_ROW_NAME,
    READ_IN_FLIGHT_NOTICE,
    RELOAD_ACTION_LABEL,
    SIGNED_OUT_ESTATE_NOTICE,
    UPDATE_AVAILABLE_EXPLANATION,
    type MetaVersionsValue,
    type ServiceVersionState,
    type VersionReadPhase,
    type VersionScope,
  } from "$lib/versions/version-overlay-model.ts";

  let {
    scope = "app",
    open = true,
    layout = "panel",
  }: {
    scope?: VersionScope;
    /**
     * Whether the report is on screen. The reads happen only while it is: the chip is on every
     * screen in the app and passes its popover's open state, so nothing is asked until somebody
     * asks; the Versions page passes true, because the page IS the asking.
     */
    open?: boolean;
    /**
     * Where the report is rendered: the chip's popover, or the Versions page at page size. Same
     * sections, same rows, same words; the page gives the rows more room and lets its plate carry
     * the title.
     */
    layout?: "panel" | "page";
  } = $props();

  const rowPadding = $derived(layout === "page" ? "py-8" : "py-4");

  const readsAggregate = $derived(readsServiceAggregate(scope));

  let value = $state<MetaVersionsValue | null>(null);
  let failure = $state<PanelReadFailure | null>(null);
  let loading = $state(false);
  let nowEpochMilliseconds = $state(Date.now());

  // The Database section's own read, kept in its own state beside the version read rather than
  // merged with it. They are two requests to two endpoints, and either can fail while the other
  // answers — a shared failure flag would let a dead health read blank the deployment list, which
  // is the opposite of what a panel opened during an outage is for.
  let healthValue = $state<DatabaseHealthValue | null>(null);
  let healthFailure = $state<PanelReadFailure | null>(null);
  let healthLoading = $state(false);

  // The upload readiness check, run WITH the other reads for a member who may run it. It is the
  // one read here that acts — the bucket settings the platform owns are re-applied as they are
  // checked, and the run is audited — so it is gated on the permission the file-safety settings
  // ride, and a member without it sees the last run on record through the health read instead.
  // Its report is the panel's fourth section — the same rows, heading and fold the Database
  // section uses — and its verdict also stands in for the File storage row while it is on hand.
  let readinessReport = $state<UploadReadinessReport | null>(null);
  let readinessFailure = $state<PanelReadFailure | null>(null);
  let readinessLoading = $state(false);
  const mayCheckReadiness = $derived(sessionPermissions.holds(CHECK_UPLOAD_READINESS_PERMISSION));

  // Sample words for the loading fixtures: an invented commit and its two timestamps, so a
  // fixture row's detail line is the width a real one is.
  const FIXTURE_COMMIT = "0f3a9c1";
  // Three rows' worth of skeleton, named by nothing real (see the fixture snippets below).
  const FIXTURE_ROW_KEYS = ["a", "b", "c"];
  const FIXTURE_ROW_NAME = "—";
  const FIXTURE_COMMIT_TIME = sampleInstant(1);
  const FIXTURE_BUILD_TIME = sampleInstant(0);
  const webCommitLabel = isRealCommit(BUILD_IDENTITY.commit) ? BUILD_IDENTITY.commit : "dev";

  // True once the version poll has seen a bundle newer than the one this tab is running.
  const updateAvailable = $derived(updated.current);

  async function refresh(options: { fresh?: boolean } = {}): Promise<void> {
    // The update check is a public asset read of this bundle's own origin, so every scope may ask.
    void updated.check();
    // The aggregate guard lives on the call itself, not only on its caller: a signed-out panel has
    // no path to the authenticated aggregate at all, including through Refresh and the failure
    // Retry.
    if (!readsAggregate) return;
    loading = true;
    // The explicit gestures (Refresh, Retry) ask for a fresh probe — a member who pressed the
    // button asked what is running NOW, and a cached answer whose age line keeps climbing reads
    // as a broken button. The automatic on-open read stays on the cached path.
    const outcome = await requestJson<MetaVersionsValue>(
      fetch,
      options.fresh === true ? "/api/v1/meta/versions?fresh=true" : "/api/v1/meta/versions",
    );
    loading = false;
    nowEpochMilliseconds = Date.now();
    if (outcome.kind === "ok") {
      value = outcome.value;
      failure = null;
    } else if (outcome.kind === "problem") {
      // The previous answer stays on screen rather than being blanked, and the failure block below
      // says how old it is. Dropping it would trade a stale row for no row, which is worse: the
      // reader loses the last thing that was true and gains nothing.
      failure = { kind: "problem", problem: outcome.problem };
    } else {
      failure = { kind: "transport" };
    }
  }

  async function refreshHealth(): Promise<void> {
    // Same scope guard as the aggregate, and for the same reason: the health read is authenticated
    // and firm-scoped, so a signed-out panel has no path to it at all.
    if (!readsAggregate) return;
    healthLoading = true;
    const outcome = await requestJson<DatabaseHealthValue>(fetch, "/api/v1/meta/database-health");
    healthLoading = false;
    if (outcome.kind === "ok") {
      healthValue = outcome.value;
      healthFailure = null;
    } else if (outcome.kind === "problem") {
      // The previous rows stay, on the same terms the deployment rows do — the last thing that was
      // true beats nothing at all — and the failure block below says the read did not land.
      healthFailure = { kind: "problem", problem: outcome.problem };
    } else {
      healthFailure = { kind: "transport" };
    }
  }

  async function refreshReadiness(): Promise<void> {
    if (!readsAggregate) return;
    // The permission read lands before the check is asked, so a member who may not run it is
    // never sent to a 403 for a button they did not press.
    await sessionPermissions.load(fetch);
    if (!sessionPermissions.holds(CHECK_UPLOAD_READINESS_PERMISSION)) return;
    readinessLoading = true;
    const outcome = await checkUploadReadiness(fetch);
    readinessLoading = false;
    if (outcome.kind === "ok") {
      readinessReport = outcome.value;
      readinessFailure = null;
    } else if (outcome.kind === "problem") {
      readinessFailure = { kind: "problem", problem: outcome.problem };
    } else {
      readinessFailure = { kind: "transport" };
    }
  }

  function refreshEverything(): void {
    void refresh({ fresh: true });
    void refreshHealth();
    void refreshReadiness();
  }

  // Every open re-reads (the API's brief cache absorbs the cost of the aggregate; the health read
  // is never cached, because its whole subject is a state that changes while somebody watches it),
  // and while the panel is open a slow tick keeps the observation-age line moving instead of
  // freezing at its first render.
  $effect(() => {
    if (!open || !readsAggregate) return;
    void refresh();
    void refreshHealth();
    void refreshReadiness();
    const ticker = setInterval(() => {
      nowEpochMilliseconds = Date.now();
    }, 5000);
    return () => clearInterval(ticker);
  });

  /*
   * COPY, AND WHETHER IT HAPPENED.
   *
   * One keyed state for every copy control in the panel — the row copies and the whole-panel copy
   * are the same gesture with different text, and they were three separate try/catch blocks that
   * each swallowed a refusal silently. copyText (design system) prefers the async clipboard and
   * falls back to the selection route where it is refused, which is exactly the case this panel
   * meets: an insecure origin, an unfocused document, a managed-browser policy. What it returns is
   * what happened, and the panel shows the difference — a copy that did not happen must never look
   * like one that did.
   *
   * The timer is held so it can be cleared: a control that unmounts mid-confirmation used to leave
   * its timeout running against state nobody was watching.
   */
  let copyOutcome = $state<{ key: string; result: "copied" | "failed" } | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => () => {
    if (copyTimer !== null) clearTimeout(copyTimer);
  });

  async function copyValue(key: string, text: string): Promise<void> {
    const result = await copyText(text);
    copyOutcome = { key, result };
    if (copyTimer !== null) clearTimeout(copyTimer);
    // A failure stays up long enough to be read and acted on; a success is a blink.
    copyTimer = setTimeout(
      () => {
        copyOutcome = null;
        copyTimer = null;
      },
      result === "copied" ? 1000 : 6000,
    );
  }

  function copiedNow(key: string): boolean {
    return copyOutcome?.key === key && copyOutcome.result === "copied";
  }

  const observationAge = $derived(
    value === null ? null : describeObservationAge(value.observedAt, nowEpochMilliseconds),
  );
  // Rows that survived a failed re-ask. They are the older read's, and the failure block says so.
  const retainedRows = $derived(
    failure !== null && value !== null
      ? describeRetainedRows(value.observedAt, nowEpochMilliseconds)
      : null,
  );

  // A retained answer still counts as answered: its web row goes on speaking for this build.
  const readPhase = $derived<VersionReadPhase>(
    value !== null ? "answered" : failure !== null ? "failed" : "pending",
  );
  const webWorkerRow = $derived(value === null ? null : findWebWorkerRow(value.services));
  const showsOwnBuild = $derived(
    showsPageBuildRow({ readsAggregate, read: readPhase, webRow: webWorkerRow }),
  );
  // Whether magna-carta-web is running the same build as magna-carta, and if not, which side is
  // behind — the colour-coded read of the pair the front rows show, in place of a fixed sentence.
  const syncState = $derived(value === null ? null : apiWebSyncState(value.api, webWorkerRow));

  // The File storage row speaks from the live report when there is one: it is newer than the audit
  // row the health read carries, and it is what the member is looking at.
  const healthRows = $derived(
    healthValue === null
      ? []
      : databaseHealthRows(healthValue).map((row) =>
          row.id === "fileStorage" && readinessReport !== null
            ? uploadReadinessRow(readinessReport)
            : row,
        ),
  );
  const provisioningBacklog = $derived(
    healthValue === null ? null : describeProvisioningBacklog(healthValue),
  );
  const schemaLineage = $derived(healthValue === null ? [] : describeSchemaLineage(healthValue));
  // The read split the way the panel now shows it: the pair that serves the app's address, and the
  // rest of the fleet. Lifted out of the template because each section's shut heading has to count
  // only the Workers ITS OWN fold hides — Workers is no longer nested inside Deployment, so one
  // count across the whole read would have both headings claiming the same silent Worker.
  const deploymentRows = $derived(value === null ? null : partitionDeploymentRows(value.services));
  // What each shut heading says. One shape for all of them (version-overlay-model.ts): a count of
  // what the fold hides, always, and a status pill only where there is one. The count is what makes
  // a quiet heading meaningful — "13 Workers" with nothing beside it is a section reporting health,
  // where an empty heading was a section reporting nothing at all.
  const deploymentPills = $derived(
    deploymentRows === null
      ? []
      : deploymentSectionPills({
          // The parts this section shows: the API, plus the pair that serves the app's address.
          partCount: 1 + deploymentRows.front.length,
          syncState,
        }),
  );
  const workersPills = $derived(
    deploymentRows === null ? [] : workersSectionPills(deploymentRows.rest),
  );
  const connectedServices = $derived(value?.connectedServices ?? []);
  const connectedPills = $derived(connectedServicesSectionPills(connectedServices));
  const databasePills = $derived(healthValue === null ? [] : databaseSectionPills(healthValue));
  const readinessPills = $derived(
    readinessReport === null ? [] : uploadReadinessSectionPills(readinessReport),
  );
  const readinessRows = $derived(
    readinessReport === null ? [] : uploadReadinessRows(readinessReport),
  );

  // Where the diff between this tab's bundle and the one the deployment is publishing lives. Only
  // once the web row has reported a different commit — until then the update poll knows a newer
  // bundle exists but not which commit it is, and a comparison needs both ends.
  const comparisonUrl = $derived(
    !readsAggregate || !updateAvailable
      ? null
      : commitComparisonUrl(BUILD_IDENTITY.commit, webWorkerRow?.commit ?? null),
  );

  // Where the source lives. Every commit on this panel is a link into this repository already; the
  // repository itself was the one address a reader had to know by heart. Signed-in only, by the
  // same rule as the commit and dashboard links: the path is internal furniture, and a sign-in
  // screen is not the place to publish it.
  const sourceUrl = $derived(readsAggregate ? repositoryUrl() : null);

  /*
   * EVERYTHING THE PANEL IS SHOWING, as one paste — assembled from the same values the rows render
   * from, so a copy can never disagree with the screen it was taken from, and including every read
   * that FAILED, which is the case the control exists for. The sections and their grammar are
   * panel-report.ts; the environment is the same block the issue reporter gathers, so a reader who
   * receives both gets one document in one format rather than two.
   */
  const panelReport = $derived(
    buildPanelReport({
      environment: open ? currentEnvironment(page.url.pathname) : null,
      pageBuild: {
        commit: webCommitLabel,
        commitTime: BUILD_IDENTITY.committedAt,
        buildTime: BUILD_IDENTITY.builtAt,
        mode: BUILD_IDENTITY.mode,
      },
      updateAvailable,
      readsAggregate,
      deployment: { value, failure },
      database: { value: healthValue, failure: healthFailure },
      readiness: {
        permitted: mayCheckReadiness,
        report: readinessReport,
        failure: readinessFailure,
      },
    }),
  );

  function badgeVariantFor(state: ServiceVersionState): "neutral" | "warning" {
    return state === "unreachable" ? "warning" : "neutral";
  }

  function metaLineFor(
    commitTime: string | null,
    buildTime: string | null,
    latencyMilliseconds: number | null,
  ): string | null {
    const committed = formatVersionTimestamp(commitTime);
    const built = formatVersionTimestamp(buildTime);
    const latency = describeProbeLatency(latencyMilliseconds);
    const segments: string[] = [];
    if (committed !== null) segments.push(`committed ${committed}`);
    if (built !== null) segments.push(`built ${built}`);
    // What the probe cost, last: it is the only part of this line that is about right now rather
    // than about the build, and a reader scanning for a timestamp should not have to step over it.
    if (latency !== null) segments.push(`answered in ${latency}`);
    return segments.length === 0 ? null : segments.join(" · ");
  }
</script>

{#snippet healthRow(row: {
  name: string;
  reading: HealthReading;
  status: string;
  detail: string;
  /** A badge tint the reading does not decide — "not applicable" is neither green nor red. */
  badgeVariant?: "neutral";
})}
  <!-- The same two-part shape the deployment rows use: the thing on the left, its state on the
       right, and the sentence beneath the name saying what that state means. A health row is prose
       about this firm rather than a dashboard identity, so no monospace. -->
  <div class="flex items-start justify-between gap-8 {rowPadding}">
    <div class="flex min-w-0 flex-col">
      <span class="text-sm text-text-default">{row.name}</span>
      <span class="text-xs text-text-muted">{row.detail}</span>
    </div>
    <Badge class="shrink-0" variant={row.badgeVariant ?? healthBadgeVariant(row.reading)}
      >{row.status}</Badge
    >
  </div>
{/snippet}

{#snippet partRow(part: {
  rowKey: string;
  name: string;
  isWorkerName: boolean;
  state: ServiceVersionState;
  commit: string | null;
  commitTime: string | null;
  buildTime: string | null;
  latencyMilliseconds?: number | null;
  /**
   * Whether this row offers a link to its commit. TRUE only for the parts a reader actually reads a
   * diff for — this build, the API, and the Worker serving this page. The fleet rows would carry
   * thirteen links to the same commit in a healthy deployment, which is noise standing in for
   * information; their Worker name still links to the dashboard, which is where a fleet question
   * actually goes.
   */
  linksToCommit?: boolean;
})}
  <!-- One detail line: the timestamps when the row reported and what the probe cost, otherwise the
       sentence naming which silence it is in — the part that separates "this deployment has no such
       worker" from "it is not answering" from "it answers, but its build predates the question",
       three facts the badges alone read as one outage. -->
  {@const latency = part.latencyMilliseconds ?? null}
  {@const detail =
    metaLineFor(part.commitTime, part.buildTime, latency) ?? serviceStateDescription(part.state)}
  {@const stateLabel = serviceStateLabel(part.state)}
  {@const dashboardUrl =
    readsAggregate && part.isWorkerName && part.state !== "unbound"
      ? workerDashboardUrl(part.name)
      : null}
  {@const commitHref =
    readsAggregate && part.linksToCommit === true ? commitUrl(part.commit) : null}
  <div class="flex items-center justify-between gap-8 {rowPadding}">
    <div class="flex min-w-0 flex-col">
      <!-- Monospace marks an identifier — a deployed Worker's name. The build line is prose about
           this tab, not a dashboard identity, so it stays in the text face. -->
      {#if dashboardUrl !== null}
        <!-- The name is the link because the name is already the thing somebody would go and open:
             the Cloudflare project the API read this row's identity off. -->
        <a
          href={dashboardUrl}
          {...opensBeside("external")}
          class="inline-flex items-center gap-4 font-mono text-sm text-text-default underline decoration-dotted underline-offset-2 hover:text-text-strong"
          aria-label="Open {part.name} in the Cloudflare dashboard"
        >
          {part.name}
          <ExternalLink class="size-12 shrink-0 text-text-muted" aria-hidden="true" />
        </a>
      {:else}
        <span
          class={part.isWorkerName
            ? "font-mono text-sm text-text-default"
            : "text-sm text-text-default"}>{part.name}</span
        >
      {/if}
      {#if detail !== null}
        <span class="text-xs text-text-muted">{detail}</span>
      {/if}
    </div>
    <div class="flex shrink-0 items-center gap-4">
      {#if isSlowProbe(latency)}
        <!-- The one state between "reported" and "unreachable": answering, but close enough to the
             probe timeout that the next slow day flips it. Said before it becomes a fault. -->
        <Badge variant="warning">Slow</Badge>
      {/if}
      {#if part.state === "reported" && part.commit !== null}
        {#if commitHref !== null}
          <Button
            variant="ghost"
            size="icon"
            href={commitHref}
            {...opensBeside("external")}
            aria-label="Open the {part.name} commit"
          >
            <ExternalLink class="size-12" aria-hidden="true" />
          </Button>
        {/if}
        <!-- The copied confirmation is the control filling in for a moment, not a glyph appearing
             beside the identifier: a check pushed the commit sideways every time it was copied, and
             the width change read as the value itself changing (owner ruling, 2026-08-31). The
             aria-label keeps stating the action for a screen reader.

             The fill is the step BEYOND ghost's own hover (which is --mc-action-secondary): whoever
             just clicked this is by definition hovering it, so a confirmation painted in the hover
             colour is no confirmation at all. -->
        <Button
          variant="ghost"
          size="sm"
          class="font-mono text-xs tabular-nums {copiedNow(part.rowKey)
            ? 'bg-action-secondary-hover'
            : ''}"
          aria-label="Copy the {part.name} version"
          onclick={() =>
            void copyValue(
              part.rowKey,
              copyLineForPart({
                label: part.name,
                commit: part.commit ?? "",
                commitTime: part.commitTime,
                buildTime: part.buildTime,
                latencyMilliseconds: latency,
              }),
            )}
        >
          {part.commit}
        </Button>
      {:else if stateLabel !== null}
        <Badge variant={badgeVariantFor(part.state)}>{stateLabel}</Badge>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet partFixture(keyPrefix: string)}
  <!-- Row shapes over sample identifiers, greyed. The names are placeholders on purpose: the API's
       roster is the one home for what the fleet contains, and a skeleton that spelled real Worker
       names would be this component asserting which Workers exist before the read has said — and
       would keep asserting it if one were ever renamed. -->
  <div class="flex flex-col">
    {#each FIXTURE_ROW_KEYS as fixtureKey (fixtureKey)}
      {@render partRow({
        rowKey: `${keyPrefix}-${fixtureKey}`,
        name: FIXTURE_ROW_NAME,
        isWorkerName: true,
        state: "reported",
        commit: FIXTURE_COMMIT,
        commitTime: FIXTURE_COMMIT_TIME,
        buildTime: FIXTURE_BUILD_TIME,
      })}
    {/each}
  </div>
{/snippet}

<!-- The report proper. In the panel this is the popover body the chip owns; on the Versions
     page it is the page itself. Same sections, same rows, same words either way. -->
<div class="flex flex-col gap-8">
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-8">
      {#if layout === "panel"}
        <p class="text-sm font-medium">Build Versions</p>
      {:else}
        <!-- The page's own plate carries the title, so heading it again here would title the page
             twice. The spacer keeps the controls in the same seat in both layouts. -->
        <span></span>
      {/if}
      <div class="flex items-center gap-4">
        {#if updateAvailable}
          <!-- The one reload gesture, seated beside Refresh because the two are the panel's
               only actions and a reader looking for either looks here. It is warning-tinted so
               it reads as the answer to the chip's dot rather than as a second refresh. -->
          <Button
            variant="ghost"
            size="icon"
            class="shrink-0 text-status-warning"
            aria-label={RELOAD_ACTION_LABEL}
            onclick={() => location.reload()}
          >
            <RotateCw class="size-16" aria-hidden="true" />
          </Button>
        {/if}
        {#if readsAggregate}
          <!-- Report an Issue, from the panel that assembled the diagnosis. Everything here is
               gathered for somebody else to read, and the only way to send it was copy, close,
               find the profile menu, paste — four steps during an incident, each of which can
               lose the paste. The dialog is the same one every other surface opens. -->
          <Button
            variant="ghost"
            size="icon"
            class="shrink-0"
            aria-label="Report an issue with this diagnosis attached"
            onclick={() => {
              // The panel gets out of the way of the dialog it opens. A no-op on the Versions
              // page, which is not a popover and has nothing to close.
              //
              // THE DIALOG IS THE SHELL'S, not this component's. Mounted here it was a child of
              // the popover that had just been told to close, so the popover's exit unmounted the
              // report about a second after it appeared — the report opened and then would not
              // stay. The shell outlives the panel; the panel hands it the diagnosis and the
              // gesture ($lib/components/issue-report.svelte.ts).
              buildPanel.close();
              issueReport.open(panelReport);
            }}
          >
            <MessageSquareWarning class="size-16" aria-hidden="true" />
          </Button>
          <!-- AT THE TOP, and it takes the WHOLE panel. Both of those were wrong before: the
               only copy control sat at the foot of the Database section and put four health rows
               on the clipboard, so a member reporting a fault pasted the database's state and
               nothing about which build was serving it — the one fact that says whether a fix has
               shipped yet. A reader reaches for Copy when they open the panel, not after
               scrolling past everything they wanted copied. -->
          <Button
            variant="ghost"
            size="icon"
            class="shrink-0 {copiedNow('panel') ? 'bg-action-secondary-hover' : ''}"
            aria-label="Copy the whole diagnosis"
            onclick={() => void copyValue("panel", panelReport)}
          >
            <!-- The two-sheets glyph every application uses for copy. It read as a clipboard with
                 an arrow before, which is the PASTE gesture's picture, so the one control in this
                 panel a person reaches for during an incident was drawn as its opposite. -->
            <Copy class="size-16" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="shrink-0"
            aria-label="Refresh the panel"
            disabled={loading || healthLoading || readinessLoading}
            onclick={refreshEverything}
          >
            <RefreshCw class="size-16" aria-hidden="true" />
          </Button>
          {#if sourceUrl !== null}
            <!-- The source itself, at the end of the cluster so the three controls beside it keep
                 the seats they have had. The panel links every commit it names to its diff and had
                 no way to the repository those diffs belong to — the address a reader ends up at
                 when the diagnosis says which build is serving and the next question is what that
                 build actually does. It opens beside, like every other link here: a reader
                 checking the source is not done with the panel. -->
            <Button
              variant="ghost"
              size="icon"
              class="shrink-0"
              href={sourceUrl}
              {...opensBeside("external")}
              aria-label="Open the source repository on GitHub"
            >
              <!-- GitHub's own mark, because this link goes to GitHub and nothing else. A
                   git-branch glyph named a git concept rather than the service, which is the one
                   fact a reader needs before they follow a link out of the application. It is a
                   third-party brand asset on the register's terms, not one of our icons
                   (docs/conventions/third-party-trademarks.md). -->
              <GithubMark class="size-16" />
            </Button>
          {/if}
        {/if}
      </div>
    </div>
    <!-- Under the header, not beside it: the age line grows and shrinks as the clock ticks, and
         on the header row that motion pushed the controls around (owner ruling, 2026-08-31). The
         in-flight word takes the same seat, so a re-ask is visible before its answer lands
         without a spinner and without moving anything. The line itself is never conditionally
         mounted — a read that lands inside the fresh window (no age line yet) or ends "Checking
         services" would otherwise make this row appear and disappear as the clock ticks past ten
         seconds, resizing the popover under the reader's eye (owner ruling, 2026-08-31); an
         empty line holds the same height so the panel's size never depends on wording. -->
    {#if readsAggregate}
      <p class="text-xs text-text-muted">
        {#if loading}
          {READ_IN_FLIGHT_NOTICE}
        {:else if healthLoading}
          {HEALTH_READ_IN_FLIGHT_NOTICE}
        {:else if observationAge !== null}
          Services {observationAge}
        {:else}
          &nbsp;
        {/if}
      </p>
    {/if}
    {#if copyOutcome?.result === "failed"}
      <!-- A refused clipboard is said out loud. The alternative — the control doing nothing at
           all — is what this panel did before, and it is indistinguishable from a copy that
           worked right up until somebody pastes an empty message into a support thread. -->
      <p class="text-xs text-status-warning">
        Your browser would not let us copy. Select the text and copy it by hand.
      </p>
    {/if}
  </div>

  {#if failure !== null}
    <div class="flex flex-col gap-4">
      <p class="text-sm text-text-default">
        {failure.kind === "problem"
          ? "The version read failed."
          : "The API could not be reached."}
      </p>
      {#if retainedRows !== null}
        <p class="text-xs text-text-muted">{retainedRows}</p>
      {/if}
      {#if failure.kind === "problem"}
        <p class="text-xs text-text-muted">
          Error ID: {failure.problem.errorId ?? "not yet assigned"} · status {failure.problem
            .status}
        </p>
      {/if}
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={loading}
          onclick={() => refresh({ fresh: true })}
        >
          Retry
        </Button>
      </div>
    </div>
  {/if}

  {#if updateAvailable}
    <!-- The words behind the header's Reload control and the chip's dot: the version poll saw a
         newer bundle where this page came from. This is a different question from the sync
         badge below (this build against the deployment serving it, not the API against
         magna-carta-web), so the two can disagree without contradicting each other. -->
    <div class="flex items-center justify-between gap-8">
      <Badge variant="warning">Update Available</Badge>
      <p class="text-xs text-text-muted">{UPDATE_AVAILABLE_EXPLANATION}</p>
    </div>
    {#if comparisonUrl !== null}
      <!-- What actually changed, which is the question the sentence above raises. It appears only
           once the web row has reported the newer commit: a comparison needs both ends, and the
           update poll knows a newer bundle exists without knowing which commit it is. -->
      <div>
        <Button variant="secondary" size="sm" href={comparisonUrl} {...opensBeside("external")}>
          <ExternalLink class="size-16" aria-hidden="true" />
          What changed
        </Button>
      </div>
    {/if}
  {/if}

  {#if showsOwnBuild}
    <!-- The build line, which appears only when no reporting magna-carta-web row is there to
         state the same commit under the name someone can act on. -->
    {@render partRow({
      rowKey: "page",
      name: PAGE_BUILD_ROW_NAME,
      isWorkerName: false,
      state: "reported",
      commit: webCommitLabel,
      commitTime: BUILD_IDENTITY.committedAt,
      buildTime: BUILD_IDENTITY.builtAt,
      linksToCommit: true,
    })}
  {/if}

  {#if readsAggregate}
    {#if value !== null || loading}
      <Separator />
      <!-- Deployment folds like the fleet below it. Shut, it wears the count of the parts it
           hides and the sync read that is the section's whole point — collapsing this heading
           takes the leading pair down with it, and a fault in the pair is the one most worth
           seeing. -->
      <VersionPanelSection
        label={DEPLOYMENT_SECTION_LABEL}
        preference={PANEL_SECTION_FOLDS.deployment}
        pills={deploymentPills}
        loading={value === null}
        refreshing={loading}
        loadingLabel="Reading what the deployment is running"
        onRetry={() => void refresh({ fresh: true })}
      >
        {#snippet fixture()}
          {@render partFixture("fixture")}
        {/snippet}
        {#if value !== null}
          {@render partRow({
            rowKey: "api",
            name: API_WORKER_UNIT_NAME,
            isWorkerName: true,
            state: "reported",
            commit: isRealCommit(value.api.commit) ? value.api.commit : "dev",
            commitTime: value.api.commitTime,
            buildTime: value.api.buildTime,
            linksToCommit: true,
          })}
          {#if value.services.length === 0}
            <p class="text-xs text-text-muted">{NO_SERVICES_NOTICE}</p>
          {:else if deploymentRows !== null}
            <!-- The two Workers that serve the app's address, with the sync read that compares
                 them. The rest of the fleet is its own section below, not a fold within this
                 one. -->
            <div class="flex flex-col">
              {#each deploymentRows.front as service (service.id)}
                {@render partRow({
                  rowKey: service.id,
                  name: service.service,
                  isWorkerName: true,
                  state: service.state,
                  commit: service.commit,
                  commitTime: service.commitTime,
                  buildTime: service.buildTime,
                  latencyMilliseconds: service.latencyMilliseconds,
                  linksToCommit: true,
                })}
              {/each}
            </div>
            {#if syncState !== null}
              <!-- The pair's sync read, colour-coded: success once magna-carta-web matches the
                   API it serves, warning only when the web build is the one behind (the
                   actionable case), neutral for any other difference — the two Workers deploy
                   separately, so differing is a normal state, not a fault. -->
              <div class="flex items-center gap-8">
                <Badge variant={syncStateBadgeVariant(syncState)}
                  >{syncStateLabel(syncState)}</Badge
                >
              </div>
            {/if}
          {/if}
        {/if}
      </VersionPanelSection>
      {#if deploymentRows === null || deploymentRows.rest.length > 0}
        <Separator />
        <!-- WORKERS IS ITS OWN SUBJECT, not a drawer inside Deployment. Nesting it made the fleet
             something a reader reached THROUGH the deployment, when in practice the two are asked
             about separately: "what build is live" and "is anything not answering" are different
             questions, and one of them was two folds deep. Shut, this heading counts only the
             Workers it hides; the pair above it is on screen and speaks for itself. -->
        <VersionPanelSection
          label={FLEET_SECTION_LABEL}
          preference={PANEL_SECTION_FOLDS.fleet}
          pills={workersPills}
          loading={value === null}
          refreshing={loading}
          loadingLabel="Reading which Workers are running"
          onRetry={() => void refresh({ fresh: true })}
        >
          {#snippet fixture()}
            {@render partFixture("fixture-worker")}
          {/snippet}
          {#if deploymentRows !== null}
            <div class="flex flex-col">
              {#each deploymentRows.rest as service (service.id)}
                {@render partRow({
                  rowKey: service.id,
                  name: service.service,
                  isWorkerName: true,
                  state: service.state,
                  commit: service.commit,
                  commitTime: service.commitTime,
                  buildTime: service.buildTime,
                  latencyMilliseconds: service.latencyMilliseconds,
                })}
              {/each}
            </div>
          {/if}
        </VersionPanelSection>
      {/if}
      {#if connectedServices.length > 0}
        <Separator />
        <!-- The outside services the deployment depends on, which run no build of ours and so are
             not Workers rows: whether each is set up and accepting this deployment, read with the
             Workers and refreshed with them. -->
        <VersionPanelSection
          label={CONNECTED_SERVICES_SECTION_LABEL}
          preference={PANEL_SECTION_FOLDS.connected}
          pills={connectedPills}
          loading={false}
          refreshing={loading}
          loadingLabel="Checking the outside services"
          onRetry={() => void refresh({ fresh: true })}
        >
          {#snippet fixture()}
            {@render healthRow({
              name: "Cloudflare Realtime (meetings)",
              reading: "healthy",
              status: "Connected",
              detail: "A meeting session opened just now.",
            })}
          {/snippet}
          <div class="flex flex-col">
            {#each connectedServices as service (service.id)}
              {@render healthRow(connectedServiceRow(service))}
            {/each}
          </div>
        </VersionPanelSection>
      {/if}
    {/if}
    <Separator />
    <!-- The panel's second subject: whether this session can reach and use its firm's own data.
         It folds on the same terms Deployment does, and a shut heading wears the worst reading in
         the section, so the one state this whole section exists to surface — a membership that
         has not landed, and every screen refusing because of it — survives being folded away. -->
    <VersionPanelSection
      label={DATABASE_SECTION_LABEL}
      preference={PANEL_SECTION_FOLDS.database}
      pills={databasePills}
      failure={healthFailure}
      failureLead="The database health read failed."
      retrying={healthLoading}
      loading={healthValue === null && healthFailure === null}
      refreshing={healthLoading}
      loadingLabel="Reading whether this firm's database can be reached"
      onRetry={() => void refreshHealth()}
    >
      {#snippet fixture()}
        <!-- Two health rows over sample readings: the section's own shape, greyed. -->
        <div class="flex flex-col">
          {@render healthRow({
            name: "Firm database",
            reading: "healthy",
            status: "Reachable",
            detail: "The firm's own database answered.",
          })}
          {@render healthRow({
            name: "Your membership",
            reading: "healthy",
            status: "Recorded",
            detail: "This account is a member of the firm.",
          })}
        </div>
      {/snippet}
      {#if healthValue !== null}
        <div class="flex flex-col">
          {#each healthRows as row (row.id)}
            {@render healthRow(row)}
          {/each}
        </div>
        {#each schemaLineage as note (note.sentence)}
          <!-- What the schema row cannot fit: a migration that arrived behind the ledger head, and
               the restore point sitting in front of the last batch. Both come off the wire from the
               firm database itself and were being dropped here; neither is a row, because a row
               that is blank on every healthy firm teaches a reader to skip it. -->
          <div class="flex items-center gap-8">
            <Badge variant={healthBadgeVariant(note.reading)}>Lineage</Badge>
            <p class="text-xs text-text-muted">{note.sentence}</p>
          </div>
        {/each}
        {#if provisioningBacklog !== null}
          <!-- The membership row's explanation, said only when there is one. A firm whose mirrors
               have all landed carries nothing here: "0 pending" is an info line with nothing
               behind it, and this line exists to turn an unexplained refusal into a wait. -->
          <div class="flex items-center gap-8">
            <Badge variant={healthBadgeVariant(provisioningBacklog.reading)}>Provisioning</Badge>
            <p class="text-xs text-text-muted">{provisioningBacklog.sentence}</p>
          </div>
        {/if}
      {/if}
    </VersionPanelSection>
    {#if mayCheckReadiness}
      <Separator />
      <!-- The panel's third subject, for a member who may act on it: whether a file chosen in
           this browser can reach the firm's storage. The check ACTS — the bucket settings the
           platform owns are re-applied as they are verified, and the run is audited — which is
           why it is gated on the permission the file-safety settings ride and why everyone else
           sees only the last run, on the File storage row above. Same heading, same fold, same
           rows as Database, so the two read as one instrument; the panel's Copy takes the
           report with everything else. -->
      <VersionPanelSection
        label={UPLOAD_READINESS_SECTION_LABEL}
        preference={PANEL_SECTION_FOLDS.readiness}
        pills={readinessPills}
        failure={readinessFailure}
        failureLead="The upload readiness check did not run."
        retrying={readinessLoading}
        loading={readinessReport === null && readinessFailure === null}
        refreshing={readinessLoading}
        loadingLabel={READINESS_CHECK_IN_FLIGHT_NOTICE}
        onRetry={() => void refreshReadiness()}
      >
        {#snippet fixture()}
          <!-- Two check rows over sample readings: the section's own shape, greyed. -->
          <div class="flex flex-col">
            {@render healthRow({
              name: "Storage bucket exists",
              reading: "healthy",
              status: "Holds",
              detail: "The firm's bucket exists in the account.",
            })}
            {@render healthRow({
              name: "The storage credential is honoured",
              reading: "healthy",
              status: "Holds",
              detail: "The credential signs a request the bucket honours.",
            })}
          </div>
        {/snippet}
        {#if readinessReport !== null}
          {@const report = readinessReport}
          <div class="flex flex-col">
            {#each readinessRows as row (row.id)}
              {@render healthRow(row)}
            {/each}
          </div>
          <!-- The verdict and the two deployment facts the rows are read against, in the
               place the Database section keeps its provisioning line. -->
          <div class="flex items-center gap-8">
            <Badge variant={report.ready ? "success" : "danger"}>
              {report.ready ? "Ready" : "Not ready"}
            </Badge>
            <p class="text-xs text-text-muted">
              {report.uploadPath === "direct-to-storage"
                ? "Files go from the browser straight to storage."
                : "Files go through the application in this deployment."}
              {#if report.bucketName !== null}
                Bucket {report.bucketName}.
              {/if}
            </p>
          </div>
        {/if}
      </VersionPanelSection>
    {/if}
  {:else}
    <!-- The signed-out panel stops at the page's own build. Saying so is the point: an absent
         deployment list with no sentence beside it reads as an outage, and this is a session
         boundary — and the same is true of the firm's database, which a visitor has not named
         yet. -->
    <Separator />
    <p class="text-xs text-text-muted">{SIGNED_OUT_ESTATE_NOTICE}</p>
    <p class="text-xs text-text-muted">{SIGNED_OUT_DATABASE_NOTICE}</p>
  {/if}
</div>
